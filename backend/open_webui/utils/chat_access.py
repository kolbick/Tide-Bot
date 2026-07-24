from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from open_webui.models.chats import ChatModel
    from sqlalchemy.ext.asyncio import AsyncSession

AccessGrants = None
Chats = None
Folders = None
ENABLE_ADMIN_CHAT_ACCESS = None
has_folder_access = None
is_internal_chat = None


def _load_dependencies() -> None:
    global AccessGrants, Chats, Folders, ENABLE_ADMIN_CHAT_ACCESS, has_folder_access, is_internal_chat
    if Chats is not None:
        return
    from open_webui.config import ENABLE_ADMIN_CHAT_ACCESS as admin_access
    from open_webui.models.access_grants import AccessGrants as access_grants
    from open_webui.models.chats import Chats as chats
    from open_webui.models.chats import is_internal_chat as internal_chat
    from open_webui.models.folders import Folders as folders
    from open_webui.utils.access_control.folders import has_folder_access as folder_access

    AccessGrants = access_grants
    Chats = chats
    Folders = folders
    ENABLE_ADMIN_CHAT_ACCESS = admin_access
    has_folder_access = folder_access
    is_internal_chat = internal_chat


async def get_readable_chat(
    user_id: str,
    role: str,
    chat_id: str,
    db: AsyncSession,
) -> ChatModel | None:
    _load_dependencies()
    chat = await Chats.get_chat_by_id_and_user_id(chat_id, user_id, db=db)
    if chat:
        return chat

    if role == 'admin':
        candidate = await Chats.get_chat_by_id(chat_id, db=db)
        if ENABLE_ADMIN_CHAT_ACCESS or (candidate and is_internal_chat(candidate.meta)):
            return candidate
        return None

    if await AccessGrants.has_access(
        user_id=user_id,
        resource_type='shared_chat',
        resource_id=chat_id,
        permission='read',
        db=db,
    ):
        chat = await Chats.get_chat_by_id(chat_id, db=db)
        if chat:
            return chat

    candidate = await Chats.get_chat_by_id(chat_id, db=db)
    if candidate and candidate.folder_id:
        folder = await Folders.get_folder_by_id(candidate.folder_id, db=db)
        if folder and await has_folder_access(user_id, folder, 'read', db):
            return candidate

    return None
