import re

CHUNK_CHARS = 1800  # unos 450 tokens
OVERLAP_CHARS = 200


def split_text(text: str) -> list[str]:
    """Trocea por párrafos hasta ~CHUNK_CHARS, con un pequeño solape entre trozos."""
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        while len(para) > CHUNK_CHARS:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(para[:CHUNK_CHARS])
            para = para[CHUNK_CHARS - OVERLAP_CHARS:]
        if len(current) + len(para) + 2 > CHUNK_CHARS and current:
            chunks.append(current)
            current = current[-OVERLAP_CHARS:] + "\n\n" + para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks
