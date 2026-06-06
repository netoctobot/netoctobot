import pytest
from unittest.mock import AsyncMock, patch
from bot.handlers.sub_bots.shared_channels import back_to_owner_panel

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
async def test_back_to_owner_panel_as_owner(
    mock_get_bot, 
    mock_callback_query, 
    mock_bot, 
    mock_i18n
):
    # إعداد: محاكاة أن المستخدم هو المالك
    sub_bot = MagicMock()
    sub_bot.owner.telegram_id = mock_callback_query.from_user.id
    mock_get_bot.return_value = sub_bot
    
    mock_callback_query.data = "back_to_owner_panel"

    # تنفيذ الدالة
    await back_to_owner_panel(mock_callback_query, mock_i18n, mock_bot)

    # التحقق من تعديل الرسالة إلى "لوحة تحكم المالك"
    mock_callback_query.message.edit_text.assert_called_once()
    args, kwargs = mock_callback_query.message.edit_text.call_args
    
    # التأكد من أن النص المترجم هو لوحة التحكم
    assert args[0] == "translated_owner-control-panel"