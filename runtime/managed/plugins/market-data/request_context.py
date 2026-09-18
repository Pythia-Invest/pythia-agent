"""Cancellation shared across a financial request's bounded worker threads."""
from contextvars import ContextVar
from functools import wraps

cancel_signal = ContextVar("pythia_financial_cancel", default=None)
usage = ContextVar('pythia_financial_usage', default='research')


def dashboard_operation(function):
    """Trusted transport scope; never accepted from tool or HTTP arguments."""
    @wraps(function)
    def call(*args, **kwargs):
        token = usage.set('dashboard')
        try: return function(*args, **kwargs)
        finally: usage.reset(token)
    return call


def cancelled():
    callback = cancel_signal.get()
    return bool(callback and callback())
