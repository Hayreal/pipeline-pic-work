from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def call_with_retries(
    fn: Callable[[], T],
    is_retryable: Callable[[BaseException], bool],
    *,
    max_attempts: int = 4,
    base_sleep_seconds: float = 1.0,
) -> T:
    last_exc: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except BaseException as exc:  # noqa: BLE001 - boundary for retries
            last_exc = exc
            if attempt == max_attempts or not is_retryable(exc):
                raise
            sleep_s = base_sleep_seconds * (2 ** (attempt - 1))
            if sleep_s > 0:
                time.sleep(sleep_s)
    assert last_exc is not None
    raise last_exc
