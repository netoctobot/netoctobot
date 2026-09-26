import pytest
from unittest.mock import AsyncMock, MagicMock
from aiogram import Bot, types
from aiogram_i18n import I18nContext

@pytest.fixture
def mock_bot():
    """محاكاة لكائن البوت"""
    bot = AsyncMock(spec=Bot)
    bot.token = "123456789:ABCDEF"
    return bot

@pytest.fixture
def mock_i18n():
    """محاكاة لسياق الترجمة"""
    i18n = MagicMock(spec=I18nContext)
    i18n.get.side_effect = lambda key, **kwargs: f"translated_{key}"
    return i18n

@pytest.fixture
def mock_user():
    """محاكاة لمستخدم تلغرام"""
    user = MagicMock(spec=types.User)
    user.id = 12345
    user.full_name = "Test User"
    user.username = "test_user"
    user.language_code = "ar"
    return user

@pytest.fixture
def mock_callback_query(mock_user):
    """محاكاة لحدث ضغط زر (CallbackQuery)"""
    callback = AsyncMock(spec=types.CallbackQuery)
    callback.from_user = mock_user
    callback.data = "some_data"
    callback.message = AsyncMock(spec=types.Message)
    return callback

@pytest.fixture
def mock_message(mock_user):
    """محاكاة لرسالة تلغرام"""
    message = AsyncMock(spec=types.Message)
    message.from_user = mock_user
    message.chat.id = 12345
    message.text = "some text"
    message.reply = AsyncMock()
    message.delete = AsyncMock()
    return message

@pytest.fixture
def mock_state():
    """محاكاة لحالة FSM"""
    state = AsyncMock()
    state.clear = AsyncMock()
    state.set_state = AsyncMock()
    state.update_data = AsyncMock()
    state.get_data = AsyncMock(return_value={})
    return state

@pytest.fixture
def mock_sub_bot(mock_owner_user):
    """محاكاة لكائن SubBot"""
    sub_bot = MagicMock()
    sub_bot.id = 1
    sub_bot.token = "123456789:ABCDEF"
    sub_bot.owner = mock_owner_user
    sub_bot.username = "test_sub_bot"
    sub_bot.bot_type = "LIST"
    sub_bot.welcome_msg = "Welcome!"
    sub_bot.welcome_parse_mode = "HTML"
    return sub_bot

@pytest.fixture
def mock_sub_bot_channel():
    """محاكاة لكائن SubBotChannel"""
    sub_bot_channel = MagicMock()
    sub_bot_channel.id = 101
    sub_bot_channel.is_active = True
    sub_bot_channel.is_frozen = False
    sub_bot_channel.channel.title = "Test Channel"
    sub_bot_channel.channel.channel_id = -1001234567890
    sub_bot_channel.save = MagicMock() # Add save method
    return sub_bot_channel