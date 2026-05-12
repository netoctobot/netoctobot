# أزرار callback على رسائل اللستة (مالك + منصة)
from uuid import UUID

from aiogram import Router, types, F, Bot
from aiogram_i18n import I18nContext
from asgiref.sync import sync_to_async

from apps.bots.models import ListButtonType, PlatformListButton, SubBotListButton
from bot.db.db_operations import get_sub_bot_by_token

router = Router()


@router.callback_query(F.data.startswith("ownlst_"))
async def owner_list_button_tap(
    callback: types.CallbackQuery, bot: Bot, i18n: I18nContext
):
    _ = i18n.get
    raw = callback.data.replace("ownlst_", "")
    try:
        btn_id = UUID(raw)
    except ValueError:
        return await callback.answer()

    sub_bot = await get_sub_bot_by_token(bot.token)

    @sync_to_async
    def _load():
        try:
            return SubBotListButton.objects.get(pk=btn_id, sub_bot=sub_bot)
        except SubBotListButton.DoesNotExist:
            return None

    btn = await _load()
    if not btn or btn.button_type != ListButtonType.CALLBACK:
        return await callback.answer()

    text = btn.callback_hint or _("list-button-no-action")
    await callback.answer(text[:200], show_alert=True)


@router.callback_query(F.data.startswith("pltbtn_"))
async def platform_list_button_tap(callback: types.CallbackQuery, i18n: I18nContext):
    _ = i18n.get
    raw = callback.data.replace("pltbtn_", "")
    try:
        btn_id = UUID(raw)
    except ValueError:
        return await callback.answer()

    @sync_to_async
    def _load():
        try:
            return PlatformListButton.objects.get(pk=btn_id)
        except PlatformListButton.DoesNotExist:
            return None

    btn = await _load()
    if not btn or btn.button_type != ListButtonType.CALLBACK:
        return await callback.answer()

    text = btn.callback_hint or _("list-button-no-action")
    await callback.answer(text[:200], show_alert=True)
