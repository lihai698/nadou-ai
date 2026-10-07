"""图片生成供应商分发规则。

这里只负责回答一个问题：当前请求应该交给哪个供应商实现。
真正的 HTTP 请求、轮询、文件保存仍由入口层传入的处理函数负责，
这样这个模块不会反向依赖 ``main.py``，也不会复制供应商协议代码。
"""

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class ImageGenerationDispatchContext:
    """由入口层计算的供应商能力，避免本模块依赖旧的全局辅助函数。"""

    is_codex: Callable[[], bool]
    is_gemini_cli: Callable[[], bool]
    is_jimeng: Callable[[], bool]
    is_runninghub: Callable[[], bool]
    is_gemini_protocol: Callable[[], bool]
    is_volcengine: Callable[[], bool]
    is_tudou_async: Callable[[], bool]
    is_tudou_grok: Callable[[], bool]


@dataclass(frozen=True)
class ImageGenerationDispatch:
    """分发结果；``model`` 是土豆请求需要的规范化模型名。"""

    route: str
    model: str


def resolve_image_generation_dispatch(
    provider: dict[str, Any],
    model: str,
    context: ImageGenerationDispatchContext,
) -> ImageGenerationDispatch:
    """按现有线上行为确定图片生成实现。

    分支顺序必须保持稳定：专用供应商先于协议判断，土豆异步和 Grok
    必须在方舟之后、通用 OpenAI 之前。新增供应商应在这里增加一个明确
    的路由和对应测试，不要在 ``main.py`` 中散落新的条件判断。
    """

    provider_id = str((provider or {}).get("id") or "")
    if provider_id == "modelscope":
        route = "modelscope"
    elif context.is_codex():
        route = "codex"
    elif context.is_gemini_cli():
        route = "gemini-cli"
    elif context.is_jimeng():
        route = "jimeng"
    elif context.is_runninghub():
        route = "runninghub"
    elif context.is_gemini_protocol():
        route = "gemini"
    elif context.is_volcengine():
        route = "volcengine"
    elif context.is_tudou_async():
        route = "tudou-async"
    elif context.is_tudou_grok():
        route = "tudou-grok"
    else:
        route = "openai"
    return ImageGenerationDispatch(route=route, model=model)
