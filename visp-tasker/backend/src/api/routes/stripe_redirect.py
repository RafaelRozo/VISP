"""Public HTML redirect pages for Stripe Connect onboarding.

Stripe's ``AccountLink.create`` rejects non-HTTPS URLs, so the mobile app
cannot pass ``visptasker://...`` deep links directly. These two routes serve
HTTPS landing pages that:

  1. Auto-trigger the ``visptasker://`` deep link via JavaScript so iOS/Android
     bounces the user back into the app without a tap.
  2. Show a fallback button + message for desktop testers or if the deep link
     handler is missing.

Routes are mounted WITHOUT the ``/api/v1`` prefix because they're user-facing
landing pages, not API endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/stripe/connect", tags=["Stripe Connect"])


_DEEP_LINK_RETURN = "visptasker://stripe-connect-return"
_DEEP_LINK_REFRESH = "visptasker://stripe-connect-refresh"


def _redirect_page(title: str, message: str, deep_link: str, cta: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title} — VISP</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #1A1A2E;
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }}
    .card {{
      max-width: 420px;
      padding: 40px 28px;
      background: #16213E;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.4);
      text-align: center;
    }}
    h1 {{ margin: 0 0 12px; font-size: 24px; }}
    p  {{ margin: 0 0 24px; color: #A0A0A0; line-height: 1.5; }}
    a.btn {{
      display: inline-block;
      padding: 12px 24px;
      background: #4A90E2;
      color: #FFFFFF;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
    }}
    a.btn:hover {{ background: #2E6AB3; }}
  </style>
</head>
<body>
  <div class="card">
    <h1>{title}</h1>
    <p>{message}</p>
    <a class="btn" href="{deep_link}">{cta}</a>
  </div>
  <script>
    // Auto-trigger the deep link on load. iOS/Android intercept this and
    // open the app. Desktop browsers ignore the unknown scheme silently.
    window.location.href = "{deep_link}";
  </script>
</body>
</html>"""


@router.get("/return", response_class=HTMLResponse, include_in_schema=False)
async def stripe_connect_return() -> HTMLResponse:
    """Landing page after Stripe Connect onboarding completes."""
    html = _redirect_page(
        title="All set",
        message=(
            "Stripe onboarding finished. Returning you to the VISP app — "
            "if it doesn't open automatically, tap below."
        ),
        deep_link=_DEEP_LINK_RETURN,
        cta="Return to VISP",
    )
    return HTMLResponse(content=html)


@router.get("/refresh", response_class=HTMLResponse, include_in_schema=False)
async def stripe_connect_refresh() -> HTMLResponse:
    """Landing page if the Stripe onboarding link expired or was abandoned."""
    html = _redirect_page(
        title="Link expired",
        message=(
            "Your Stripe onboarding link expired. Open the VISP app and try "
            "again to generate a fresh link."
        ),
        deep_link=_DEEP_LINK_REFRESH,
        cta="Open VISP",
    )
    return HTMLResponse(content=html)
