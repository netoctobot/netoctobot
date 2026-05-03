import logging
from asgiref.sync import sync_to_async
from apps.bots.models import SubBot, SubBotChannel,PublishedList
from bot.utils.formatters import generate_list_message
from bot.loader import i18n_core  # استيراد الكور للترجمة
from bot.utils.collection import active_bots_instances # استيراد النسخ المحفوظة
from bot.keyboards.inline.bot_management import generate_list_keyboards
from django.utils import timezone
from datetime import timedelta

logger = logging.getLogger(__name__)

async def delete_post_for_bot(sub_bot_id, chat_id, message_id):
    # 1. الحصول على بيانات البوت من قاعدة البيانات (اختياري إذا كنت تملك التوكن)
    # أو الوصول مباشرة عبر القاموس الذي تملكه
    from bot.utils.collection import active_bots_instances
    
    # لنفترض أنك تمرر sub_bot_id، نحتاج للحصول على التوكن أولاً
    # ملاحظة: تأكد من تمرير التوكن للدالة أو جلبه داخلها
    
    # ابحث عن نسخة البوت النشطة
    bot_instance = None
    for token, instance in active_bots_instances.items():
        # هنا يمكنك المقارنة بالـ ID إذا كان مخزناً أو تمرير التوكن مباشرة للدالة
        if str(instance.id) == str(sub_bot_id): # مثال للمقارنة
            bot_instance = instance
            break

    if bot_instance:
        try:
            # 2. تنفيذ أمر الحذف
            await bot_instance.delete_message(chat_id=chat_id, message_id=message_id)
            print(f"✅ تم حذف الرسالة {message_id} بنجاح من الشات {chat_id}")
        except Exception as e:
            # تليجرام قد يرفض الحذف إذا كانت الرسالة قديمة جداً (> 48 ساعة)
            # أو إذا قام المشرف بحذفها يدوياً
            print(f"⚠️ فشل حذف الرسالة {message_id}: {e}")
    else:
        print(f"❌ لم يتم العثور على نسخة نشطة للبوت ID: {sub_bot_id}")
  
async def run_auto_post_for_bot(sub_bot_id: int):
    try:
        # 1. جلب بيانات البوت والتمبلت
        sub_bot = await sync_to_async(SubBot.objects.select_related('list_config').get)(id=sub_bot_id)
        
        config = sub_bot.list_config
        
        # 2. جلب نسخة البوت "المشغلة بالفعل" من القاموس
        bot_instance = active_bots_instances.get(sub_bot.token)
        
        if not bot_instance:
            logger.error(f"❌ لم يتم العثور على نسخة نشطة للبوت {sub_bot.name}. هل هو مشغل؟")
            return

        # 3. تجهيز الـ i18n يدوياً للمجدول (بما أنه لا يوجد middleware هنا)
        # نستخدم دالة التنسيق مع تمرير i18n_core
        message_text = await generate_list_message(sub_bot, i18n_core)
        
        if not message_text:
            return

        # 4. جلب القنوات
        channels = await sync_to_async(list)(
            SubBotChannel.objects.filter(sub_bot=sub_bot, is_active=True).select_related('channel')
        )

        # 5. النشر باستخدام النسخة الأصلية bot_instance
        for bot_chan in channels:
            try:
                sent_msg = await bot_instance.send_message(
                    chat_id=bot_chan.channel.channel_id,
                    text=message_text,
                    disable_web_page_preview=True,
                    reply_markup=generate_list_keyboards(sub_bot, i18n_core)
                )
                
                # ✅ الخطوة المنسية: تسجيل الرسالة للحذف مستقبلاً
                # إذا كان المالك قد حدد وقت حذف (أكبر من 0)
                if config.delete_after > 0:
                    deletion_time = timezone.now() + timedelta(seconds=config.delete_after)
                
                    await sync_to_async(PublishedList.objects.create)(
                        sub_bot=sub_bot,
                        channel_id=bot_chan.channel.channel_id,
                        message_id=sent_msg.message_id,
                        delete_at=deletion_time
                    )
                    
                logger.info(f"✅ [AutoPost] {sub_bot.name} -> {bot_chan.channel.title}")
            except Exception as e:
                logger.error(f"❌ فشل النشر في {bot_chan.channel.title}: {e}")

    except Exception as e:
        logger.error(f"🚨 خطأ في task البوت {sub_bot_id}: {e}")

async def auto_delete_expired_messages():
    """
    تلف على كل الرسائل في PublishedList التي حان وقت حذفها ولم تُحذف بعد.
    """
    now = timezone.now()
    
    # جلب الرسائل المنتهية (التي وقت حذفها أصغر من الآن ولم تُحذف)
    expired_messages = await sync_to_async(list)(
        PublishedList.objects.filter(
            delete_at__lte=now, 
            is_deleted=False
        ).select_related('sub_bot')
    )
    
    for item in expired_messages:
        try:
            # استخدام النسخة النشطة من البوت من القاموس الذي أنشأناه
            bot_instance = active_bots_instances.get(item.sub_bot.token)
            
            if bot_instance:
                await bot_instance.delete_message(
                    chat_id=item.channel_id,
                    message_id=item.message_id
                )
                
                # تحديث الحالة في قاعدة البيانات
                item.is_deleted = True
                await sync_to_async(item.save)()
                logger.info(f"🗑️ تم حذف رسالة قديمة من القناة {item.channel_id}")
            
        except Exception as e:
            # إذا فشل الحذف (مثلاً المالك حذف الرسالة يدوياً أو طرد البوت)
            # نعتبرها محذوفة لكي لا يحاول المنظف حذفها للأبد
            item.is_deleted = True
            await sync_to_async(item.save)()
            logger.warning(f"⚠️ فشل حذف رسالة (ربما حُذفت يدوياً): {e}")