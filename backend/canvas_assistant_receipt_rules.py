"""画布操作与会话恢复共用的纯回执编号规则。"""
import hashlib


def receipt_key(user, request_id):
    return hashlib.sha256((user + ":" + request_id).encode()).hexdigest()
