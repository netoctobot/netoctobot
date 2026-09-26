import pytest
from unittest.mock import AsyncMock, patch
from bot.handlers.sub_bots.shared_channels import back_to_owner_panel

@pytest.fixture
def mock_owner_user():
    """محاكاة لمستخدم تلغرام (المالك)"""
    user = MagicMock(spec=types.User)
    user.id = 54321
    user.full_name = "Test Owner"
    user.username = "test_owner"
    user.language_code = "ar"
    return user

@pytest.fixture
def mock_sub_bot_partner(mock_user):
    """محاكاة لكائن SubBot حيث المستخدم الحالي ليس المالك"""
    sub_bot = MagicMock()
    sub_bot.id = 2
    sub_bot.token = "987654321:FEDCBA"
    sub_bot.owner = MagicMock(telegram_id=99999) # Different owner
    sub_bot.username = "test_partner_bot"
    sub_bot.bot_type = "CONTACT"
    sub_bot.welcome_msg = "Hello partner!"
    sub_bot.welcome_parse_mode = "MarkdownV2"
    return sub_bot

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_subbot_owner_keyboard")
async def test_back_to_owner_panel_as_owner(
    mock_get_owner_keyboard,
    mock_get_bot,
    mock_callback_query,
    mock_i18n,
    mock_bot,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup: mock_sub_bot is owned by mock_owner_user
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user # Ensure callback is from owner
    mock_callback_query.data = "back_to_owner_panel"

    mock_get_owner_keyboard.return_value = "owner_keyboard_markup"

    # Execute
    await back_to_owner_panel(mock_callback_query, mock_i18n, mock_bot)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_callback_query.message.edit_text.assert_called_once_with(
        "translated_owner-control-panel",
        reply_markup="owner_keyboard_markup",
    )
    mock_get_owner_keyboard.assert_called_once_with(mock_i18n, mock_sub_bot)
    mock_callback_query.answer.assert_not_called() # No answer if message is edited

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_user_main_menu")
@patch("bot.handlers.sub_bots.shared_channels.get_list_bot_user_keyboard")
@patch("bot.handlers.sub_bots.shared_channels.format_personal_message")
async def test_back_to_owner_panel_as_partner(
    mock_format_personal_message,
    mock_get_list_bot_user_keyboard,
    mock_get_user_main_menu,
    mock_get_bot,
    mock_callback_query,
    mock_i18n,
    mock_bot,
    mock_sub_bot_partner, # Use the partner bot fixture
    mock_user, # Use the regular user fixture
):
    # Setup: mock_sub_bot_partner is NOT owned by mock_user
    mock_get_bot.return_value = mock_sub_bot_partner
    mock_callback_query.from_user = mock_user
    mock_callback_query.data = "back_to_owner_panel"

    mock_get_list_bot_user_keyboard.return_value = "list_user_keyboard"
    mock_get_user_main_menu.return_value = "main_menu_keyboard"
    mock_format_personal_message.return_value = "Formatted Welcome Message"

    # Execute
    await back_to_owner_panel(mock_callback_query, mock_i18n, mock_bot)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    if mock_sub_bot_partner.bot_type == "LIST":
        mock_get_list_bot_user_keyboard.assert_called_once_with(mock_i18n)
        mock_callback_query.message.edit_text.assert_called_once_with(
            text="Formatted Welcome Message",
            reply_markup="list_user_keyboard",
        )
    else:
        mock_get_user_main_menu.assert_called_once_with(mock_i18n, mock_sub_bot_partner.bot_type)
        mock_callback_query.message.edit_text.assert_called_once_with(
            text="Formatted Welcome Message",
            reply_markup="main_menu_keyboard",
        )
    mock_format_personal_message.assert_called_once()
    mock_callback_query.answer.assert_not_called()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
async def test_back_to_owner_panel_no_sub_bot(
    mock_get_bot,
    mock_callback_query,
    mock_i18n,
    mock_bot,
):
    # Setup: no sub_bot found
    mock_get_bot.return_value = None
    mock_callback_query.data = "back_to_owner_panel"

    # Execute
    await back_to_owner_panel(mock_callback_query, mock_i18n, mock_bot)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_callback_query.answer.assert_called_once() # Should answer if no sub_bot
    mock_callback_query.message.edit_text.assert_not_called()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_channels_list")
@patch("bot.handlers.sub_bots.shared_channels.get_channels_management_keyboard")
async def test_manage_channels_list_as_owner_with_channels(
    mock_get_keyboard,
    mock_get_channels_list,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_owner_user,
    mock_sub_bot_channel,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user
    mock_get_channels_list.return_value = [mock_sub_bot_channel]
    mock_get_keyboard.return_value = "channels_keyboard_markup"

    # Execute
    await manage_channels_list(mock_callback_query, mock_bot, mock_i18n)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_get_channels_list.assert_called_once_with(mock_sub_bot, user_id=None) # Owner sees all
    mock_callback_query.message.edit_text.assert_called_once_with(
        "translated_list-channel-management",
        reply_markup="channels_keyboard_markup",
    )
    mock_get_keyboard.assert_called_once_with(mock_i18n, [mock_sub_bot_channel])
    mock_callback_query.answer.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_channels_list")
@patch("bot.handlers.sub_bots.shared_channels.get_channels_management_keyboard")
async def test_manage_channels_list_as_partner_with_channels(
    mock_get_keyboard,
    mock_get_channels_list,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot_partner,
    mock_user,
    mock_sub_bot_channel,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot_partner
    mock_callback_query.from_user = mock_user
    mock_get_channels_list.return_value = [mock_sub_bot_channel]
    mock_get_keyboard.return_value = "channels_keyboard_markup"

    # Execute
    await manage_channels_list(mock_callback_query, mock_bot, mock_i18n)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_get_channels_list.assert_called_once_with(mock_sub_bot_partner, user_id=mock_user.id) # Partner sees only their channels
    mock_callback_query.message.edit_text.assert_called_once_with(
        "translated_list-channel-management",
        reply_markup="channels_keyboard_markup",
    )
    mock_get_keyboard.assert_called_once_with(mock_i18n, [mock_sub_bot_channel])
    mock_callback_query.answer.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_channels_list")
@patch("bot.handlers.sub_bots.shared_channels.get_channels_management_keyboard")
async def test_manage_channels_list_no_channels(
    mock_get_keyboard,
    mock_get_channels_list,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user
    mock_get_channels_list.return_value = []
    mock_get_keyboard.return_value = "empty_channels_keyboard"

    # Execute
    await manage_channels_list(mock_callback_query, mock_bot, mock_i18n)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_get_channels_list.assert_called_once_with(mock_sub_bot, user_id=None)
    mock_callback_query.message.edit_text.assert_called_once_with(
        "translated_list-channel-management", # Owner message for no channels
        reply_markup="empty_channels_keyboard",
    )
    mock_get_keyboard.assert_called_once_with(mock_i18n, [])
    mock_callback_query.answer.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_subbot_owner_keyboard")
async def test_cancel_add_channel_handler_as_owner(
    mock_get_owner_keyboard,
    mock_get_bot,
    mock_callback_query,
    mock_state,
    mock_i18n,
    mock_bot,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user
    mock_get_owner_keyboard.return_value = "owner_keyboard_markup"

    # Execute
    await cancel_add_channel_handler(mock_callback_query, mock_state, mock_i18n, mock_bot)

    # Assertions
    mock_state.clear.assert_called_once()
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_callback_query.message.edit_text.assert_called_once_with(
        "translated_owner-control-panel",
        reply_markup="owner_keyboard_markup",
    )
    mock_get_owner_keyboard.assert_called_once_with(mock_i18n, mock_sub_bot)
    mock_callback_query.answer.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_user_main_menu")
@patch("bot.handlers.sub_bots.shared_channels.get_list_bot_user_keyboard")
@patch("bot.handlers.sub_bots.shared_channels.format_personal_message")
async def test_cancel_add_channel_handler_as_partner(
    mock_format_personal_message,
    mock_get_list_bot_user_keyboard,
    mock_get_user_main_menu,
    mock_get_bot,
    mock_callback_query,
    mock_state,
    mock_i18n,
    mock_bot,
    mock_sub_bot_partner,
    mock_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot_partner
    mock_callback_query.from_user = mock_user
    mock_get_list_bot_user_keyboard.return_value = "list_user_keyboard"
    mock_get_user_main_menu.return_value = "main_menu_keyboard"
    mock_format_personal_message.return_value = "Formatted Welcome Message"

    # Execute
    await cancel_add_channel_handler(mock_callback_query, mock_state, mock_i18n, mock_bot)

    # Assertions
    mock_state.clear.assert_called_once()
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_format_personal_message.assert_called_once()
    mock_callback_query.message.edit_text.assert_called_once()
    mock_callback_query.answer.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_add_bot_as_admin_and_cancel")
async def test_start_add_channel(
    mock_get_keyboard,
    mock_get_bot,
    mock_callback_query,
    mock_state,
    mock_i18n,
    mock_bot,
    mock_sub_bot,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_get_keyboard.return_value = "add_channel_keyboard"

    # Execute
    await start_add_channel(mock_callback_query, mock_state, mock_i18n, mock_bot)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_state.clear.assert_called_once()
    mock_state.set_state.assert_called_once_with(AddChannelSG.waiting_for_forward)
    mock_state.update_data.assert_called_once_with(target_bot_id=mock_sub_bot.id)
    mock_callback_query.message.edit_text.assert_called_once_with(
        "translated_how-add-channel",
        reply_markup="add_channel_keyboard",
    )
    mock_get_keyboard.assert_called_once_with(mock_i18n, mock_sub_bot.username, "cancel_add_channel")
    mock_callback_query.answer.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
async def test_start_add_channel_no_sub_bot(
    mock_get_bot,
    mock_callback_query,
    mock_state,
    mock_i18n,
    mock_bot,
):
    # Setup
    mock_get_bot.return_value = None

    # Execute
    await start_add_channel(mock_callback_query, mock_state, mock_i18n, mock_bot)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_state.clear.assert_not_called()
    mock_state.set_state.assert_not_called()
    mock_state.update_data.assert_not_called()
    mock_callback_query.message.edit_text.assert_not_called()
    mock_callback_query.answer.assert_not_called() # No answer if early exit

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
async def test_process_channel_forward_with_command(
    mock_delete_message_after,
    mock_get_bot,
    mock_message,
    mock_bot,
    mock_i18n,
    mock_state,
):
    # Setup
    mock_message.text = "/start"
    mock_get_bot.return_value = MagicMock() # SubBot exists, but command takes precedence
    mock_message.reply.return_value = AsyncMock()

    # Execute
    await process_channel_forward(mock_message, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_state.clear.assert_called_once()
    mock_message.reply.assert_called_once_with("translated_repeat-command", reply_markup=None)
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_add_bot_as_admin_and_cancel")
async def test_process_channel_forward_invalid_chat_type(
    mock_get_keyboard,
    mock_delete_message_after,
    mock_get_bot,
    mock_message,
    mock_bot,
    mock_i18n,
    mock_state,
    mock_sub_bot,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_message.text = None # Not a command
    mock_message.forward_from_chat = MagicMock(type="private") # Invalid chat type
    mock_message.reply.return_value = AsyncMock()
    mock_get_keyboard.return_value = "cancel_keyboard"

    # Execute
    await process_channel_forward(mock_message, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_message.reply.assert_called_once_with(
        "translated_please-send-msg-from-channel",
        markup="cancel_keyboard",
    )
    mock_get_keyboard.assert_called_once_with(mock_i18n, mock_sub_bot.username, "cancel_add_channel")
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_add_bot_as_admin_and_cancel")
async def test_process_channel_forward_bot_not_admin(
    mock_get_keyboard,
    mock_delete_message_after,
    mock_get_bot,
    mock_message,
    mock_bot,
    mock_i18n,
    mock_state,
    mock_sub_bot,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_message.text = None
    mock_message.forward_from_chat = MagicMock(id=-100123, type="channel", title="Test Channel")
    mock_bot.get_chat_member.return_value = MagicMock(status="member") # Bot is not admin
    mock_message.reply.return_value = AsyncMock()
    mock_get_keyboard.return_value = "cancel_keyboard"

    # Execute
    await process_channel_forward(mock_message, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_bot.get_chat_member.assert_called_once_with(chat_id=-100123, user_id=mock_bot.id)
    mock_message.reply.assert_called_once_with("translated_bot-not-administrato-make-it", reply_markup=None)
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_chat_invite_link")
@patch("bot.handlers.sub_bots.shared_channels.add_channel_to_sub_bot_logic")
@patch("bot.handlers.sub_bots.shared_channels.get_subbot_owner_keyboard")
async def test_process_channel_forward_owner_success(
    mock_get_owner_keyboard,
    mock_add_channel_logic,
    mock_get_invite_link,
    mock_delete_message_after,
    mock_get_bot,
    mock_message,
    mock_bot,
    mock_i18n,
    mock_state,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_message.from_user = mock_owner_user # Owner is forwarding
    mock_message.text = None
    mock_message.forward_from_chat = MagicMock(
        id=-100123, type="channel", title="Owner Channel", username="owner_chan"
    )
    mock_bot.get_chat_member.return_value = MagicMock(status="administrator")
    mock_get_invite_link.return_value = "https://t.me/joinchat/owner"
    mock_add_channel_logic.return_value = (True, 101, True) # Success, is_owner=True
    mock_message.reply.return_value = AsyncMock()
    mock_get_owner_keyboard.return_value = "owner_keyboard"

    # Execute
    await process_channel_forward(mock_message, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_bot.get_chat_member.assert_called_once()
    mock_get_invite_link.assert_called_once()
    mock_add_channel_logic.assert_called_once_with(
        sub_bot=mock_sub_bot,
        chat_id=-100123,
        title="Owner Channel",
        username="owner_chan",
        invite_link="https://t.me/joinchat/owner",
        telegram_user_id=mock_owner_user.id,
    )
    mock_state.clear.assert_called_once()
    mock_message.reply.assert_called_once_with(
        "translated_channel-successfully-added",
        markup="owner_keyboard",
    )
    mock_get_owner_keyboard.assert_called_once_with(mock_i18n, mock_sub_bot)
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_chat_invite_link")
@patch("bot.handlers.sub_bots.shared_channels.add_channel_to_sub_bot_logic")
@patch("bot.handlers.sub_bots.shared_channels.ok")
@patch("bot.handlers.sub_bots.shared_channels.InlineKeyboardBuilder")
async def test_process_channel_forward_partner_success(
    mock_inline_keyboard_builder,
    mock_ok_keyboard,
    mock_add_channel_logic,
    mock_get_invite_link,
    mock_delete_message_after,
    mock_get_bot,
    mock_message,
    mock_bot,
    mock_i18n,
    mock_state,
    mock_sub_bot,
    mock_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_message.from_user = mock_user # Partner is forwarding
    mock_message.text = None
    mock_message.forward_from_chat = MagicMock(
        id=-100124, type="channel", title="Partner Channel", username="partner_chan"
    )
    mock_bot.get_chat_member.return_value = MagicMock(status="administrator")
    mock_get_invite_link.return_value = "https://t.me/joinchat/partner"
    mock_add_channel_logic.return_value = (True, 102, False) # Success, is_owner=False
    mock_message.reply.return_value = AsyncMock()
    mock_ok_keyboard.return_value = "ok_keyboard"

    mock_builder_instance = MagicMock()
    mock_inline_keyboard_builder.return_value = mock_builder_instance
    mock_builder_instance.as_markup.return_value = "notification_keyboard"

    # Execute
    await process_channel_forward(mock_message, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_bot.get_chat_member.assert_called_once()
    mock_get_invite_link.assert_called_once()
    mock_add_channel_logic.assert_called_once_with(
        sub_bot=mock_sub_bot,
        chat_id=-100124,
        title="Partner Channel",
        username="partner_chan",
        invite_link="https://t.me/joinchat/partner",
        telegram_user_id=mock_user.id,
    )
    mock_state.clear.assert_called_once()
    mock_message.reply.assert_called_once_with(
        "translated_request-forwarded-owner",
        markup="ok_keyboard",
    )
    mock_ok_keyboard.assert_called_once_with(mock_i18n)
    mock_bot.send_message.assert_called_once_with(
        chat_id=mock_sub_bot.owner.telegram_id,
        text="translated_new-joining-request",
        reply_markup="notification_keyboard",
    )
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_chat_invite_link")
@patch("bot.handlers.sub_bots.shared_channels.add_channel_to_sub_bot_logic")
async def test_process_channel_forward_channel_already_exists(
    mock_add_channel_logic,
    mock_get_invite_link,
    mock_delete_message_after,
    mock_get_bot,
    mock_message,
    mock_bot,
    mock_i18n,
    mock_state,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_message.from_user = mock_owner_user
    mock_message.text = None
    mock_message.forward_from_chat = MagicMock(
        id=-100123, type="channel", title="Existing Channel", username="existing_chan"
    )
    mock_bot.get_chat_member.return_value = MagicMock(status="administrator")
    mock_get_invite_link.return_value = "https://t.me/joinchat/existing"
    mock_add_channel_logic.return_value = (False, 101, True) # Channel already exists
    mock_message.reply.return_value = AsyncMock()

    # Execute
    await process_channel_forward(mock_message, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_add_channel_logic.assert_called_once()
    mock_state.clear.assert_not_called() # Should not clear state if not successful
    mock_message.reply.assert_called_once_with("translated_channel-already-exists", reply_markup=None)
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.process_channel_deletion_logic")
@patch("bot.handlers.sub_bots.shared_channels.manage_channels_list")
async def test_delete_channel_from_bot_bot_is_admin(
    mock_manage_channels_list,
    mock_process_deletion_logic,
    mock_get_bot,
    mock_callback_query,
    mock_i18n,
    mock_bot,
    mock_sub_bot,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot # Not directly used in this handler, but good practice
    mock_callback_query.data = "delete_chan_123"
    mock_bot.get_chat_member.return_value = MagicMock(status="administrator")
    mock_process_deletion_logic.return_value = ("Channel Name", "frozen")

    # Mock _get_cid to return a channel ID
    with patch("bot.handlers.sub_bots.shared_channels.SubBotChannel") as MockSubBotChannel:
        MockSubBotChannel.objects.get.return_value.channel.channel_id = -1001234567890
        
        # Execute
        await delete_channel_from_bot(mock_callback_query, mock_i18n, mock_bot)

        # Assertions
        mock_bot.get_chat_member.assert_called_once_with(chat_id=-1001234567890, user_id=mock_bot.id)
        mock_process_deletion_logic.assert_called_once_with("123", True)
        mock_callback_query.answer.assert_called_once_with(
            "translated_msg-channel-frozen", show_alert=True
        )
        mock_manage_channels_list.assert_called_once_with(mock_callback_query, mock_bot, mock_i18n)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.process_channel_deletion_logic")
@patch("bot.handlers.sub_bots.shared_channels.manage_channels_list")
async def test_delete_channel_from_bot_bot_not_admin(
    mock_manage_channels_list,
    mock_process_deletion_logic,
    mock_get_bot,
    mock_callback_query,
    mock_i18n,
    mock_bot,
    mock_sub_bot,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.data = "delete_chan_124"
    mock_bot.get_chat_member.return_value = MagicMock(status="member") # Bot is not admin
    mock_process_deletion_logic.return_value = ("Another Channel", "deleted")

    with patch("bot.handlers.sub_bots.shared_channels.SubBotChannel") as MockSubBotChannel:
        MockSubBotChannel.objects.get.return_value.channel.channel_id = -1001987654321
        
        # Execute
        await delete_channel_from_bot(mock_callback_query, mock_i18n, mock_bot)

        # Assertions
        mock_bot.get_chat_member.assert_called_once_with(chat_id=-1001987654321, user_id=mock_bot.id)
        mock_process_deletion_logic.assert_called_once_with("124", False)
        mock_callback_query.answer.assert_called_once_with(
            "translated_msg-deleted-from-list", show_alert=True
        )
        mock_manage_channels_list.assert_called_once_with(mock_callback_query, mock_bot, mock_i18n)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.process_channel_deletion_logic")
@patch("bot.handlers.sub_bots.shared_channels.manage_channels_list")
async def test_delete_channel_from_bot_error_during_deletion(
    mock_manage_channels_list,
    mock_process_deletion_logic,
    mock_get_bot,
    mock_callback_query,
    mock_i18n,
    mock_bot,
    mock_sub_bot,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.data = "delete_chan_125"
    # Simulate an exception during get_chat_member or process_channel_deletion_logic
    mock_bot.get_chat_member.side_effect = Exception("Telegram API error")

    with patch("bot.handlers.sub_bots.shared_channels.SubBotChannel") as MockSubBotChannel:
        MockSubBotChannel.objects.get.return_value.channel.channel_id = -1001987654321
        
        # Execute
        await delete_channel_from_bot(mock_callback_query, mock_i18n, mock_bot)

        # Assertions
        mock_callback_query.answer.assert_called_once_with(
            "translated_error-occurred-during-deletion", show_alert=True
        )
        mock_manage_channels_list.assert_not_called() # Should not call manage_channels_list on error

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.InlineKeyboardBuilder")
async def test_on_bot_added_as_admin_owner(
    mock_inline_keyboard_builder,
    mock_get_bot,
    mock_bot,
    mock_i18n,
    mock_state,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    event = MagicMock(spec=types.ChatMemberUpdated)
    event.chat.title = "Admin Chat"
    event.chat.id = -100155555
    event.from_user = mock_owner_user # Owner added the bot

    mock_builder_instance = MagicMock()
    mock_inline_keyboard_builder.return_value = mock_builder_instance
    mock_builder_instance.as_markup.return_value = "confirm_keyboard"

    # Execute
    await on_bot_added_as_admin(event, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_state.clear.assert_called_once()
    mock_bot.send_message.assert_called_once_with(
        chat_id=mock_owner_user.id,
        text="translated_owner-msg-successful-added-bot",
        reply_markup="confirm_keyboard",
    )
    mock_inline_keyboard_builder.assert_called_once()
    mock_builder_instance.button.assert_called_once_with(
        text="translated_send-add-request", callback_data=f"confirm_auto_add_{event.chat.id}"
    )

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.InlineKeyboardBuilder")
async def test_on_bot_added_as_admin_partner(
    mock_inline_keyboard_builder,
    mock_get_bot,
    mock_bot,
    mock_i18n,
    mock_state,
    mock_sub_bot,
    mock_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    event = MagicMock(spec=types.ChatMemberUpdated)
    event.chat.title = "Partner Chat"
    event.chat.id = -100166666
    event.from_user = mock_user # Partner added the bot

    mock_builder_instance = MagicMock()
    mock_inline_keyboard_builder.return_value = mock_builder_instance
    mock_builder_instance.as_markup.return_value = "confirm_keyboard"

    # Execute
    await on_bot_added_as_admin(event, mock_bot, mock_i18n, mock_state)

    # Assertions
    mock_get_bot.assert_called_once_with(mock_bot.token)
    mock_state.clear.assert_called_once()
    mock_bot.send_message.assert_called_once_with(
        chat_id=mock_user.id,
        text="translated_msg-successful-added-bot",
        reply_markup="confirm_keyboard",
    )
    mock_inline_keyboard_builder.assert_called_once()
    mock_builder_instance.button.assert_called_once_with(
        text="translated_send-add-request", callback_data=f"confirm_auto_add_{event.chat.id}"
    )

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_chat_invite_link")
@patch("bot.handlers.sub_bots.shared_channels.add_channel_to_sub_bot_logic")
async def test_finalize_auto_add_owner_success(
    mock_add_channel_logic,
    mock_get_invite_link,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user
    mock_callback_query.data = "confirm_auto_add_-100177777"
    mock_bot.get_chat.return_value = MagicMock(
        id=-100177777, title="Auto Add Channel", username="auto_add_chan"
    )
    mock_get_invite_link.return_value = "https://t.me/joinchat/auto"
    mock_add_channel_logic.return_value = (True, 103, True) # Success, is_owner=True

    # Execute
    await finalize_auto_add(mock_callback_query, mock_bot, mock_i18n)

    # Assertions
    mock_bot.get_chat.assert_called_once_with(-100177777)
    mock_get_invite_link.assert_called_once()
    mock_add_channel_logic.assert_called_once_with(
        sub_bot=mock_sub_bot,
        chat_id=-100177777,
        title="Auto Add Channel",
        username="auto_add_chan",
        invite_link="https://t.me/joinchat/auto",
        telegram_user_id=mock_owner_user.id,
    )
    mock_callback_query.answer.assert_called_once_with(
        "translated_channel-successfully-added", show_alert=True
    )
    mock_callback_query.message.delete.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_chat_invite_link")
@patch("bot.handlers.sub_bots.shared_channels.add_channel_to_sub_bot_logic")
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.InlineKeyboardBuilder")
async def test_finalize_auto_add_partner_success(
    mock_inline_keyboard_builder,
    mock_delete_message_after,
    mock_add_channel_logic,
    mock_get_invite_link,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_user
    mock_callback_query.data = "confirm_auto_add_-100188888"
    mock_bot.get_chat.return_value = MagicMock(
        id=-100188888, title="Partner Auto Add", username="partner_auto"
    )
    mock_get_invite_link.return_value = "https://t.me/joinchat/partner_auto"
    mock_add_channel_logic.return_value = (True, 104, False) # Success, is_owner=False
    mock_callback_query.message.edit_text.return_value = AsyncMock()

    mock_builder_instance = MagicMock()
    mock_inline_keyboard_builder.return_value = mock_builder_instance
    mock_builder_instance.as_markup.return_value = "notification_keyboard"

    # Execute
    await finalize_auto_add(mock_callback_query, mock_bot, mock_i18n)

    # Assertions
    mock_bot.get_chat.assert_called_once_with(-100188888)
    mock_get_invite_link.assert_called_once()
    mock_add_channel_logic.assert_called_once_with(
        sub_bot=mock_sub_bot,
        chat_id=-100188888,
        title="Partner Auto Add",
        username="partner_auto",
        invite_link="https://t.me/joinchat/partner_auto",
        telegram_user_id=mock_user.id,
    )
    mock_callback_query.answer.assert_not_called() # No answer, message is edited
    mock_callback_query.message.edit_text.assert_called_once_with("translated_request-forwarded-owner")
    mock_delete_message_after.assert_called_once_with(mock_callback_query.message.edit_text.return_value)
    mock_bot.send_message.assert_called_once_with(
        chat_id=mock_sub_bot.owner.telegram_id,
        text="translated_new-joining-request",
        reply_markup="notification_keyboard",
    )

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_chat_invite_link")
@patch("bot.handlers.sub_bots.shared_channels.add_channel_to_sub_bot_logic")
async def test_finalize_auto_add_channel_already_exists(
    mock_add_channel_logic,
    mock_get_invite_link,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_owner_user,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user
    mock_callback_query.data = "confirm_auto_add_-100199999"
    mock_bot.get_chat.return_value = MagicMock(
        id=-100199999, title="Existing Auto Add", username="existing_auto"
    )
    mock_get_invite_link.return_value = "https://t.me/joinchat/existing_auto"
    mock_add_channel_logic.return_value = (False, 105, True) # Channel already exists

    # Execute
    await finalize_auto_add(mock_callback_query, mock_bot, mock_i18n)

    # Assertions
    mock_add_channel_logic.assert_called_once()
    mock_callback_query.answer.assert_called_once_with(
        "translated_channel-already-exists", show_alert=True
    )
    mock_callback_query.message.delete.assert_not_called()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.manage_channels_list")
async def test_toggle_channel_status_owner_active_to_inactive(
    mock_manage_channels_list,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_owner_user,
    mock_sub_bot_channel,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user
    mock_callback_query.data = f"toggle_chan_{mock_sub_bot_channel.id}"

    # Mock _get_info to return an active channel
    with patch("bot.handlers.sub_bots.shared_channels.SubBotChannel") as MockSubBotChannel:
        MockSubBotChannel.objects.select_related.return_value.get.return_value = (
            mock_sub_bot_channel, True, "Active Channel"
        )
        # Mock _owner_toggle to simulate deactivation
        with patch("bot.handlers.sub_bots.shared_channels.sync_to_async") as mock_sync_to_async:
            mock_sync_to_async.side_effect = lambda func: func if func.__name__ == '_owner_toggle' else AsyncMock(return_value=func)
            
            # Mock the actual save operation within _owner_toggle
            mock_sub_bot_channel.is_active = True # Initial state
            def _owner_toggle_mock(sc):
                sc.is_active = not sc.is_active
                return sc.is_active
            mock_sync_to_async.return_value = _owner_toggle_mock(mock_sub_bot_channel) # Simulate the return value

            # Execute
            await toggle_channel_status(mock_callback_query, mock_bot, mock_i18n)

            # Assertions
            mock_get_bot.assert_called_once_with(mock_bot.token)
            mock_callback_query.answer.assert_called_once_with(
                "translated_change-state", show_alert=True
            )
            mock_manage_channels_list.assert_called_once_with(mock_callback_query, mock_bot, mock_i18n)
            # Verify that the channel's active status was toggled
            assert mock_sub_bot_channel.is_active == False

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.manage_channels_list")
async def test_toggle_channel_status_owner_inactive_to_active(
    mock_manage_channels_list,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_owner_user,
    mock_sub_bot_channel,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_owner_user
    mock_callback_query.data = f"toggle_chan_{mock_sub_bot_channel.id}"

    # Mock _get_info to return an inactive channel
    with patch("bot.handlers.sub_bots.shared_channels.SubBotChannel") as MockSubBotChannel:
        MockSubBotChannel.objects.select_related.return_value.get.return_value = (
            mock_sub_bot_channel, False, "Inactive Channel"
        )
        # Mock _owner_toggle to simulate activation
        with patch("bot.handlers.sub_bots.shared_channels.sync_to_async") as mock_sync_to_async:
            mock_sync_to_async.side_effect = lambda func: func if func.__name__ == '_owner_toggle' else AsyncMock(return_value=func)
            
            mock_sub_bot_channel.is_active = False # Initial state
            def _owner_toggle_mock(sc):
                sc.is_active = not sc.is_active
                return sc.is_active
            mock_sync_to_async.return_value = _owner_toggle_mock(mock_sub_bot_channel)

            # Execute
            await toggle_channel_status(mock_callback_query, mock_bot, mock_i18n)

            # Assertions
            mock_get_bot.assert_called_once_with(mock_bot.token)
            mock_callback_query.answer.assert_called_once_with(
                "translated_change-state", show_alert=True
            )
            mock_manage_channels_list.assert_called_once_with(mock_callback_query, mock_bot, mock_i18n)
            assert mock_sub_bot_channel.is_active == True

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.manage_channels_list")
async def test_toggle_channel_status_partner_deactivates_active_channel(
    mock_manage_channels_list,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_user,
    mock_sub_bot_channel,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_user # Partner
    mock_callback_query.data = f"toggle_chan_{mock_sub_bot_channel.id}"

    # Mock _get_info to return an active channel
    with patch("bot.handlers.sub_bots.shared_channels.SubBotChannel") as MockSubBotChannel:
        MockSubBotChannel.objects.select_related.return_value.get.return_value = (
            mock_sub_bot_channel, True, "Partner Active Channel"
        )
        # Mock _partner_deactivate
        with patch("bot.handlers.sub_bots.shared_channels.sync_to_async") as mock_sync_to_async:
            mock_sync_to_async.side_effect = lambda func: func if func.__name__ == '_partner_deactivate' else AsyncMock(return_value=func)
            
            mock_sub_bot_channel.is_active = True # Initial state
            def _partner_deactivate_mock(sc):
                sc.is_active = False
            mock_sync_to_async.return_value = _partner_deactivate_mock(mock_sub_bot_channel)

            # Execute
            await toggle_channel_status(mock_callback_query, mock_bot, mock_i18n)

            # Assertions
            mock_get_bot.assert_called_once_with(mock_bot.token)
            mock_callback_query.answer.assert_called_once_with(
                "translated_change-state", show_alert=True
            )
            mock_manage_channels_list.assert_called_once_with(mock_callback_query, mock_bot, mock_i18n)
            assert mock_sub_bot_channel.is_active == False

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.manage_channels_list")
@patch("bot.handlers.sub_bots.shared_channels.InlineKeyboardBuilder")
async def test_toggle_channel_status_partner_activates_inactive_channel(
    mock_inline_keyboard_builder,
    mock_manage_channels_list,
    mock_get_bot,
    mock_callback_query,
    mock_bot,
    mock_i18n,
    mock_sub_bot,
    mock_user,
    mock_sub_bot_channel,
):
    # Setup
    mock_get_bot.return_value = mock_sub_bot
    mock_callback_query.from_user = mock_user # Partner
    mock_callback_query.data = f"toggle_chan_{mock_sub_bot_channel.id}"

    # Mock _get_info to return an inactive channel
    with patch("bot.handlers.sub_bots.shared_channels.SubBotChannel") as MockSubBotChannel:
        MockSubBotChannel.objects.select_related.return_value.get.return_value = (
            mock_sub_bot_channel, False, "Partner Inactive Channel"
        )
        mock_builder_instance = MagicMock()
        mock_inline_keyboard_builder.return_value = mock_builder_instance
        mock_builder_instance.as_markup.return_value = "notification_keyboard"

        # Execute
        await toggle_channel_status(mock_callback_query, mock_bot, mock_i18n)

        # Assertions
        mock_get_bot.assert_called_once_with(mock_bot.token)
        mock_callback_query.answer.assert_called_once_with(
            "translated_request-forwarded-owner", show_alert=True
        )
        mock_manage_channels_list.assert_not_called() # Not called for partner activation request
        mock_bot.send_message.assert_called_once_with(
            chat_id=mock_sub_bot.owner.telegram_id,
            text="translated_new-joining-request",
            reply_markup="notification_keyboard",
        )
        assert mock_sub_bot_channel.is_active == False # Should remain inactive

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.get_sub_bot_by_token")
@patch("bot.handlers.sub_bots.shared_channels.get_cancel_keyboard")
async def test_start_set_support_link(
    mock_get_cancel_keyboard,
    mock_get_bot,
    mock_callback_query,
    mock_state,
    mock_i18n,
):
    # Setup
    mock_get_bot.return_value = MagicMock(id=123) # SubBot exists
    mock_callback_query.data = "set_support_123"
    mock_get_cancel_keyboard.return_value = "cancel_keyboard_markup"

    # Execute
    await start_set_support_link(mock_callback_query, mock_state, mock_i18n)

    # Assertions
    mock_state.set_state.assert_called_once_with(SubBotSettingsSG.waiting_for_support_link)
    mock_state.update_data.assert_called_once_with(target_bot_id="123")
    mock_callback_query.message.edit_text.assert_called_once_with(
        "translated_msg-send-support-link",
        reply_markup="cancel_keyboard_markup",
    )
    mock_get_cancel_keyboard.assert_called_once_with(mock_i18n)
    mock_callback_query.answer.assert_called_once()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_user_and_subscription")
@patch("bot.handlers.sub_bots.shared_channels.set_sub_bot_support_link")
@patch("bot.handlers.sub_bots.shared_channels.get_subbot_owner_keyboard")
async def test_process_support_link_valid_http_link(
    mock_get_owner_keyboard,
    mock_set_support_link,
    mock_get_user_and_subscription,
    mock_delete_message_after,
    mock_message,
    mock_state,
    mock_bot,
    mock_i18n,
    mock_owner_user,
    mock_sub_bot,
):
    # Setup
    mock_message.text = "https://t.me/support_channel"
    mock_state.get_data.return_value = {"target_bot_id": mock_sub_bot.id}
    mock_get_user_and_subscription.return_value = (mock_owner_user, MagicMock(bot=mock_sub_bot, last_main_message_id=123), False)
    mock_set_support_link.return_value = True
    mock_get_owner_keyboard.return_value = "owner_keyboard_markup"

    # Execute
    await process_support_link(mock_message, mock_state, mock_bot, mock_i18n)

    # Assertions
    mock_set_support_link.assert_called_once_with(mock_sub_bot.id, mock_owner_user, "https://t.me/support_channel")
    mock_state.clear.assert_called_once()
    mock_delete_message_after.assert_called_with(mock_message, 1)
    mock_bot.edit_message_text.assert_called_once_with(
        chat_id=mock_message.chat.id,
        message_id=123,
        text="translated_owner-control-panel",
        reply_markup="owner_keyboard_markup",
    )
    mock_get_owner_keyboard.assert_called_once_with(mock_i18n, mock_sub_bot)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_user_and_subscription")
@patch("bot.handlers.sub_bots.shared_channels.set_sub_bot_support_link")
@patch("bot.handlers.sub_bots.shared_channels.get_subbot_owner_keyboard")
async def test_process_support_link_valid_username_link(
    mock_get_owner_keyboard,
    mock_set_support_link,
    mock_get_user_and_subscription,
    mock_delete_message_after,
    mock_message,
    mock_state,
    mock_bot,
    mock_i18n,
    mock_owner_user,
    mock_sub_bot,
):
    # Setup
    mock_message.text = "@support_username"
    mock_state.get_data.return_value = {"target_bot_id": mock_sub_bot.id}
    mock_get_user_and_subscription.return_value = (mock_owner_user, MagicMock(bot=mock_sub_bot, last_main_message_id=123), False)
    mock_set_support_link.return_value = True
    mock_get_owner_keyboard.return_value = "owner_keyboard_markup"

    # Execute
    await process_support_link(mock_message, mock_state, mock_bot, mock_i18n)

    # Assertions
    mock_set_support_link.assert_called_once_with(mock_sub_bot.id, mock_owner_user, "https://t.me/support_username")
    mock_state.clear.assert_called_once()
    mock_delete_message_after.assert_called_with(mock_message, 1)
    mock_bot.edit_message_text.assert_called_once_with(
        chat_id=mock_message.chat.id,
        message_id=123,
        text="translated_owner-control-panel",
        reply_markup="owner_keyboard_markup",
    )
    mock_get_owner_keyboard.assert_called_once_with(mock_i18n, mock_sub_bot)

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_user_and_subscription")
@patch("bot.handlers.sub_bots.shared_channels.set_sub_bot_support_link")
async def test_process_support_link_invalid_link(
    mock_set_support_link,
    mock_get_user_and_subscription,
    mock_delete_message_after,
    mock_message,
    mock_state,
    mock_bot,
    mock_i18n,
):
    # Setup
    mock_message.text = "invalid link"
    mock_message.reply.return_value = AsyncMock()

    # Execute
    await process_support_link(mock_message, mock_state, mock_bot, mock_i18n)

    # Assertions
    mock_message.reply.assert_called_once_with("translated_err-invalid-link")
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)
    mock_set_support_link.assert_not_called()
    mock_state.clear.assert_not_called()

@pytest.mark.asyncio
@patch("bot.handlers.sub_bots.shared_channels.delete_message_after")
@patch("bot.handlers.sub_bots.shared_channels.get_user_and_subscription")
@patch("bot.handlers.sub_bots.shared_channels.set_sub_bot_support_link")
async def test_process_support_link_set_link_failure(
    mock_set_support_link,
    mock_get_user_and_subscription,
    mock_delete_message_after,
    mock_message,
    mock_state,
    mock_bot,
    mock_i18n,
    mock_owner_user,
    mock_sub_bot,
):
    # Setup
    mock_message.text = "https://t.me/valid_link"
    mock_state.get_data.return_value = {"target_bot_id": mock_sub_bot.id}
    mock_get_user_and_subscription.return_value = (mock_owner_user, MagicMock(bot=mock_sub_bot, last_main_message_id=123), False)
    mock_set_support_link.return_value = False # Simulate failure
    mock_message.reply.return_value = AsyncMock()

    # Execute
    await process_support_link(mock_message, mock_state, mock_bot, mock_i18n)

    # Assertions
    mock_set_support_link.assert_called_once()
    mock_message.reply.assert_called_once_with("translated_err-system-error")
    mock_delete_message_after.assert_called_with(mock_message.reply.return_value)
    mock_delete_message_after.assert_called_with(mock_message)
    mock_state.clear.assert_not_called()
    mock_bot.edit_message_text.assert_not_called()