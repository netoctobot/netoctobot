from bot.config import BOT_TOKEN
from aiogram import Router, F
from .common import main_menu, settings, navigation
from .my_bots import add_bot, list_bots
from bot.handlers.sub_bots.contact_logic import router as contact_router
from bot.handlers.sub_bots.list_logic import router as list_router
from bot.handlers.sub_bots.list_post_callbacks import router as list_post_callbacks_router
from bot.handlers.sub_bots.mandatory_subscribe_handlers import (
    router as mandatory_subscribe_router,
)
from bot.handlers.sub_bots.shared_channels import router as shared_channels_router

def get_handlers_router() -> Router:
    # 1. الروتر الأب (المظلة الكبيرة - بدون فلاتر تقييدية)
    main_router = Router()

    # 2. روتر خاص بالبوت الرئيسي فقط (Admin Zone)
    master_router = Router()
    master_router.message.filter(F.bot.token == BOT_TOKEN)
    master_router.callback_query.filter(F.bot.token == BOT_TOKEN)
    
    # دمج راوترات الإدارة داخل روتر الماستر
    master_router.include_routers(
        main_menu.router, 
        settings.router, 
        add_bot.router, 
        list_bots.router
    )

    # 3. روتر خاص بالبوتات الفرعية فقط (Sub-Bots Zone)
    sub_bots_parent_router = Router()
    sub_bots_parent_router.message.filter(F.bot.token != BOT_TOKEN)
    sub_bots_parent_router.callback_query.filter(F.bot.token != BOT_TOKEN)

    # دمج منطق التواصل واللستة داخل روتر البوتات الفرعية
    sub_bots_parent_router.include_router(shared_channels_router)
    sub_bots_parent_router.include_router(mandatory_subscribe_router)
    sub_bots_parent_router.include_router(list_post_callbacks_router)
    sub_bots_parent_router.include_router(contact_router)
    sub_bots_parent_router.include_router(list_router)

    # 4. دمج المجموعتين في الروتر الأب
    main_router.include_router(master_router)
    main_router.include_router(sub_bots_parent_router)
    main_router.include_router(navigation.router)

    return main_router