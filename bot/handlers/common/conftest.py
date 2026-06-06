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
def mock_state():
    """محاكاة لحالة FSM"""
    return AsyncMock()