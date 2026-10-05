"""应用版本号解析与比较。

这个模块只负责把版本文本转换为可比较的数字序列，并比较两个版本的
大小。它不读取配置、不访问网络，也不依赖应用入口，便于独立测试和复用。
"""

import re
from typing import List


def version_tuple(value: str) -> List[int]:
    """提取版本文本中的数字段，保持旧入口的返回类型和容错行为。"""
    return [int(item) for item in re.findall(r"\d+", str(value or ""))]


def version_gt(a: str, b: str) -> bool:
    """判断版本 *a* 是否高于版本 *b*，缺失段按 0 补齐。"""
    first, second = version_tuple(a), version_tuple(b)
    length = max(len(first), len(second))
    first += [0] * (length - len(first))
    second += [0] * (length - len(second))
    return first > second
