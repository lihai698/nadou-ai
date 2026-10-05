"""低耦合扩展合同与注册表。

扩展只能通过显式描述注册，并以统一结果结构返回。模块不扫描目录、不加载
第三方代码，也不主动访问网络；调用方可以在启动时按配置注册自己的适配器。
"""

from __future__ import annotations

from dataclasses import dataclass, field
import importlib.util
import re
from typing import Any, Callable, Iterable, Mapping, Optional


_EXTENSION_ID_RE = re.compile(r"^[a-z][a-z0-9_.-]{1,63}$")


class ExtensionError(ValueError):
    """扩展合同或调用参数不满足约定。"""


class ExtensionDisabled(ExtensionError):
    """扩展已被配置停用。"""


class ExtensionDependencyMissing(ExtensionError):
    """扩展声明的 Python 依赖不可用。"""


@dataclass(frozen=True)
class ExtensionDescriptor:
    id: str
    name: str
    version: str
    license: str
    source: str
    input_schema: Mapping[str, Any]
    output_schema: Mapping[str, Any]
    dependencies: tuple[str, ...] = ()
    enabled: bool = True
    handler: Callable[[Mapping[str, Any]], Mapping[str, Any]] = field(
        default=lambda payload: payload,
        repr=False,
        compare=False,
    )

    def __post_init__(self) -> None:
        if not _EXTENSION_ID_RE.fullmatch(str(self.id or "")):
            raise ExtensionError("扩展编号无效")
        if not str(self.name or "").strip():
            raise ExtensionError("扩展名称不能为空")
        if not str(self.version or "").strip() or not str(self.license or "").strip():
            raise ExtensionError("扩展版本和许可证不能为空")
        if not callable(self.handler):
            raise ExtensionError("扩展处理器无效")


@dataclass(frozen=True)
class ExtensionResult:
    status: str
    output: Optional[Mapping[str, Any]] = None
    error: str = ""
    progress: float = 0.0

    def public(self) -> dict[str, Any]:
        result = {
            "status": self.status,
            "progress": max(0.0, min(1.0, float(self.progress))),
        }
        if self.output is not None:
            result["output"] = dict(self.output)
        if self.error:
            result["error"] = str(self.error)[:240]
        return result


class ExtensionRegistry:
    """一个进程内的显式扩展注册表。"""

    def __init__(self, descriptors: Iterable[ExtensionDescriptor] = ()) -> None:
        self._items: dict[str, ExtensionDescriptor] = {}
        for descriptor in descriptors:
            self.register(descriptor)

    def register(self, descriptor: ExtensionDescriptor) -> None:
        if descriptor.id in self._items:
            raise ExtensionError("扩展编号重复")
        self._items[descriptor.id] = descriptor

    def disable(self, extension_id: str) -> None:
        descriptor = self._items.get(str(extension_id or "").strip())
        if descriptor is None:
            raise ExtensionError("扩展不存在")
        self._items[descriptor.id] = ExtensionDescriptor(
            **{**descriptor.__dict__, "enabled": False}
        )

    def descriptors(self) -> tuple[ExtensionDescriptor, ...]:
        return tuple(self._items[key] for key in sorted(self._items))

    def public_descriptors(self) -> list[dict[str, Any]]:
        return [
            {
                "id": item.id,
                "name": item.name,
                "version": item.version,
                "license": item.license,
                "source": item.source,
                "dependencies": list(item.dependencies),
                "enabled": item.enabled,
                "available": not self._missing_dependencies(item),
                "missing_dependencies": list(self._missing_dependencies(item)),
            }
            for item in self.descriptors()
        ]

    @staticmethod
    def _missing_dependencies(descriptor: ExtensionDescriptor) -> tuple[str, ...]:
        missing: list[str] = []
        for name in descriptor.dependencies:
            try:
                if importlib.util.find_spec(name) is None:
                    missing.append(name)
            except (ImportError, ModuleNotFoundError, ValueError):
                missing.append(name)
        return tuple(missing)

    def run(self, extension_id: str, payload: Mapping[str, Any]) -> ExtensionResult:
        descriptor = self._items.get(str(extension_id or "").strip())
        if descriptor is None:
            return ExtensionResult("failed", error="扩展不存在")
        if not descriptor.enabled:
            return ExtensionResult("disabled", error="扩展已停用")
        if self._missing_dependencies(descriptor):
            return ExtensionResult("unavailable", error="扩展依赖未安装")
        if not isinstance(payload, Mapping):
            return ExtensionResult("failed", error="扩展输入必须是对象")
        try:
            output = descriptor.handler(payload)
            if not isinstance(output, Mapping):
                raise ExtensionError("扩展输出必须是对象")
            return ExtensionResult("succeeded", output=dict(output), progress=1.0)
        except ExtensionError as exc:
            return ExtensionResult("failed", error=str(exc)[:240])
        except Exception as exc:
            return ExtensionResult("failed", error=f"扩展执行失败：{type(exc).__name__}")


__all__ = [
    "ExtensionDescriptor",
    "ExtensionDisabled",
    "ExtensionDependencyMissing",
    "ExtensionError",
    "ExtensionRegistry",
    "ExtensionResult",
]
