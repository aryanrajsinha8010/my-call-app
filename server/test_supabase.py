import sys
import os

# Adjust path to import db
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.supabase_api import create_room_db, add_contact_db, _headers

print("Testing headers generation:")
print(_headers(use_bearer=True))

import uuid
room_id = f"test-room-{uuid.uuid4().hex[:8]}"
print(f"\nAttempting to create a test room with ID '{room_id}':")
try:
    res = create_room_db(
        room_id=room_id,
        room_name="Test Room",
        ephemeral_mode=True,
        metadata_stripping=True,
        data_residency_region="US"
    )
    print("Room creation SUCCESS:", res)
except Exception as e:
    print("Room creation FAILED:", str(e))

print("\nAttempting to query get_contacts_db:")
try:
    from db.supabase_api import get_contacts_db
    contacts_res = get_contacts_db("PROFESSOR")
    print("get_contacts_db PROFESSOR results:", contacts_res)
except Exception as e:
    print("Failed get_contacts_db:", str(e))
