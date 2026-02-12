
import sys
import uuid
import sys
import os

# Add backend directory to path
sys.path.append('/Volumes/MachintoshHD/Cursos/VISP/visp-tasker/backend')

from src.api.schemas.provider import ProviderCategoryOut, ProviderTaskOut
from src.models.provider import ProviderLevel
from src.models.taxonomy import ServiceCategory, ServiceTask

def test_serialization():
    print("Testing serialization with REAL models...")
    
    # Create instances of real ORM models
    t1 = ServiceTask()
    t1.id = uuid.uuid4()
    t1.slug = "task-slug"
    t1.name = "Task 1"
    t1.description = "desc"
    t1.level = ProviderLevel.LEVEL_1
    t1.category_id = uuid.uuid4()
    t1.regulated = False
    t1.license_required = False
    t1.hazardous = False
    t1.structural = False
    t1.is_active = True
    # Needed for Pydantic if it checks all fields? No, only what's in schema.

    c1 = ServiceCategory()
    c1.id = uuid.uuid4()
    c1.slug = "cat-slug"
    c1.name = "Category 1"
    c1.icon_url = None
    c1.display_order = 1
    
    # This is the monkey-patching done in taxonomy_service.py
    # If ServiceCategory prevents this, it will fail here.
    try:
        t_correct = ServiceTask()
        t_correct.id = uuid.uuid4()
        t_correct.slug = "correct-task"
        t_correct.name = "CORRECT TASK"
        t_correct.level = ProviderLevel.LEVEL_1
        t_correct.category_id = c1.id
        t_correct.is_active = True
        t_correct.regulated = False
        t_correct.license_required = False
        t_correct.hazardous = False
        t_correct.structural = False
        
        c1.active_tasks_list = [t_correct]
        
        # Simulate the relationship attribute existence (usually InstrumentedList)
        # In real app, accessing this might trigger lazy load crash
        c1.tasks = [] 
        
        print("Monkey-patching successful.")
    except Exception as e:
        print(f"Monkey-patching FAILED: {e}")
        return

    try:
        # This is exactly what the route does
        dump = ProviderCategoryOut.model_validate(c1).model_dump(by_alias=True)
        print("Serialization Success!")
        print(dump)
    except Exception as e:
        print(f"Serialization FAILED: {e}")

if __name__ == "__main__":
    test_serialization()
