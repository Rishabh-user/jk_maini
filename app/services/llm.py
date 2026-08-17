"""Provider-agnostic LLM client.

Every AI call in the app (column mapping + fallback extraction) goes through
here, so switching providers or models is a single env var (AI_PROVIDER) — no
caller imports a vendor SDK directly.

    complete_json()         → text prompt in, JSON-string out (column mapping)
    complete_vision_json()  → system + text + images in, JSON-string out (extraction)
    ai_enabled()            → is the active provider's key configured?

Supported providers: "openai" (default) and "anthropic". OpenAI uses JSON mode
(response_format=json_object) so the returned text is always valid JSON.
"""
from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()


def _provider() -> str:
    return (settings.AI_PROVIDER or "openai").strip().lower()


def ai_enabled() -> bool:
    """True when the active provider has an API key set. Callers use this to
    decide between the AI path and the deterministic keyword fallback."""
    p = _provider()
    if p == "openai":
        return bool(settings.OPENAI_API_KEY)
    if p == "anthropic":
        return bool(settings.ANTHROPIC_API_KEY)
    return False


def _model(kind: str) -> str:
    """kind: 'extract' (vision/extraction) | 'map' (column mapping)."""
    p = _provider()
    if p == "openai":
        return settings.OPENAI_EXTRACTION_MODEL if kind == "extract" else settings.OPENAI_MODEL
    return settings.EXTRACTION_MODEL if kind == "extract" else settings.AI_MODEL


def _strip_to_json(raw: str) -> str:
    """Pull the JSON object out of a response that may be wrapped in prose or
    ```json fences (Anthropic doesn't have a strict JSON mode)."""
    raw = (raw or "").strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw
    if "```" in raw or "{" in raw:
        s, e = raw.find("{"), raw.rfind("}") + 1
        if s != -1 and e > s:
            return raw[s:e]
    return raw


async def complete_json(prompt: str, *, system: str | None = None, kind: str = "map",
                        max_tokens: int = 1024, temperature: float = 0) -> str:
    """Send a text prompt; return the model's response text (expected JSON)."""
    p = _provider()
    if p == "openai":
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        resp = await client.chat.completions.create(
            model=_model(kind), max_tokens=max_tokens, temperature=temperature,
            response_format={"type": "json_object"}, messages=msgs,
        )
        return resp.choices[0].message.content or ""
    if p == "anthropic":
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        kwargs = {"model": _model(kind), "max_tokens": max_tokens, "temperature": temperature,
                  "messages": [{"role": "user", "content": prompt}]}
        if system:
            kwargs["system"] = system
        msg = await client.messages.create(**kwargs)
        return _strip_to_json("".join(b.text for b in msg.content if getattr(b, "type", None) == "text"))
    raise RuntimeError(f"Unknown AI_PROVIDER: {p!r}")


async def complete_vision_json(*, system: str, user_text: str,
                               images: list[tuple[str, str]] | None = None,
                               max_tokens: int = 8000) -> str:
    """Extraction call: system prompt + a combined user text + optional images
    (list of (media_type, base64)). Returns the model's response text (JSON)."""
    images = images or []
    p = _provider()
    if p == "openai":
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        content: list[dict] = [
            {"type": "image_url", "image_url": {"url": f"data:{mt};base64,{b64}"}}
            for mt, b64 in images
        ]
        content.append({"type": "text", "text": user_text or "(no text)"})
        resp = await client.chat.completions.create(
            model=_model("extract"), max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
        )
        return resp.choices[0].message.content or ""
    if p == "anthropic":
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        content: list[dict] = [
            {"type": "image", "source": {"type": "base64", "media_type": mt, "data": b64}}
            for mt, b64 in images
        ]
        content.append({"type": "text", "text": user_text or "(no text)"})
        msg = await client.messages.create(
            model=_model("extract"), max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": content}],
        )
        return _strip_to_json("".join(b.text for b in msg.content if getattr(b, "type", None) == "text"))
    raise RuntimeError(f"Unknown AI_PROVIDER: {p!r}")
