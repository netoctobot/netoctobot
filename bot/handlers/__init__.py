from aiogram import Router
from .common import main_menu, settings
from .my_bots import add_bot, list_bots

def get_handlers_router() -> Router:
    router = Router()
    
    # دمج كل الراوترات الفرعية في راوتر واحد رئيسي
    router.include_router(main_menu.router)
    router.include_router(settings.router)
    router.include_router(add_bot.router)
    router.include_router(list_bots.router)
    return router