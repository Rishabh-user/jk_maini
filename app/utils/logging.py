import logging
import sys

from app.utils.config import get_settings


def setup_logging() -> logging.Logger:
    settings = get_settings()
    logger = logging.getLogger("jk_maini")
    logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)

    if not logger.handlers:
        logger.addHandler(handler)

    return logger


logger = setup_logging()
