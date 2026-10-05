"""模型名称校验、候选列表去重和默认回退规则。

这个模块只处理调用方传入的模型值，不读取供应商配置、不访问网络，也不
决定具体供应商协议。HTTP 入口继续通过 ``HTTPException`` 保持原有错误
状态和提示文本。
"""

from fastapi import HTTPException


MAX_MODEL_NAME_LENGTH = 240


def selected_model(requested, fallback):
    """返回清理后的模型名称，缺失或包含控制字符时拒绝请求。"""
    model = (requested or fallback).strip()
    if not model:
        raise HTTPException(status_code=400, detail="模型名称不能为空")
    if len(model) > MAX_MODEL_NAME_LENGTH or any(
        ord(ch) < 32 or ord(ch) == 127 for ch in model
    ):
        raise HTTPException(status_code=400, detail=f"模型名称不合法：{model}")
    return model


def model_list_from_values(values):
    """清理候选模型列表并按首次出现顺序去重。"""
    deduped = []
    for value in values or []:
        item = str(value or "").strip()
        if item and item not in deduped:
            selected_model(item, item)
            deduped.append(item)
    return deduped


def normalize_model_list(values):
    """兼容旧入口名称，统一调用候选模型列表规整规则。"""
    return model_list_from_values(values)
