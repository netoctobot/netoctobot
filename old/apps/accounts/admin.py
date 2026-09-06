from django.contrib import admin
from .models import TelegramUser, Wallet, Transaction

@admin.register(TelegramUser)
class TelegramUserAdmin(admin.ModelAdmin):
    list_display = ('telegram_id', 'full_name', 'username', 'is_partner', 'date_joined')
    search_fields = ('telegram_id', 'full_name', 'username')
    list_filter = ('is_partner', 'date_joined')

@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ('user', 'balance', 'pending_balance', 'total_earned', 'preferred_method')
    search_fields = ('user__full_name', 'user__telegram_id')
    list_filter = ('preferred_method', 'country')

@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ('wallet', 'amount', 'tx_type', 'status', 'timestamp')
    list_filter = ('tx_type', 'status', 'timestamp')
    search_fields = ('wallet__user__full_name', 'reason')