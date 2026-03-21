from aiogram import Router
from .common import main_menu, settings, navigation
from .my_bots import add_bot, list_bots
from bot.handlers.sub_bots.contact_logic import router as contact_router

def get_handlers_router() -> Router:
    router = Router()
    
    # دمج كل الراوترات الفرعية في راوتر واحد رئيسي
    router.include_router(main_menu.router)
    router.include_router(settings.router)
    router.include_router(add_bot.router)
    router.include_router(list_bots.router)
    router.include_router(navigation.router)
    router.include_router(contact_router)

    return router