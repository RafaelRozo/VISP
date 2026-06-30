import asyncio
from src.core.config import settings
import stripe

stripe.api_key = settings.stripe_secret_key

try:
    setup_intent = stripe.SetupIntent.create(
        customer="cus_fake123", # Or let's test a generic customer
        automatic_payment_methods={"enabled": True},
    )
    print("Success:", setup_intent.id)
except Exception as e:
    print("Error:", e)

