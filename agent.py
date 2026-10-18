"""NOVA Agent by onelife: an AI that drives a real Chromium browser on Linux.
It reads TASK, plans, clicks, types, logs in and posts, like a person would.
Passwords come from GitHub Secrets and are hidden from the AI (it only sees placeholders)."""
import os, asyncio, pathlib
from browser_use import Agent, ChatGoogle

OUT = pathlib.Path("agent/out"); OUT.mkdir(parents=True, exist_ok=True)
TASK = os.environ["TASK"]

# The AI writes x_user / x_pass and the real values are filled in privately.
secrets = {k: v for k, v in {
    "x_user": os.getenv("X_USER"), "x_pass": os.getenv("X_PASS"),
    "pin_user": os.getenv("PIN_USER"), "pin_pass": os.getenv("PIN_PASS"),
}.items() if v}

RULES = """
You are NOVA, created by 🩸onelife🩸. Do the task in the browser.
- To log in to X use x_user and x_pass. For Pinterest use pin_user and pin_pass.
- For Amazon affiliate posts: open the product link, take the product title and main image,
  write a catchy caption with 2 hashtags and #ad, and include the affiliate link.
- If a captcha, phone code or 2-step check appears, stop and report it.
- Finish with a short report of what you did and any post links.
"""

async def main():
    llm = ChatGoogle(model="gemini-flash-latest")
    agent = Agent(task=TASK + "\n" + RULES, llm=llm, sensitive_data=secrets or None, use_vision=True)
    history = await agent.run(max_steps=60)
    report = history.final_result() or "No final report."
    print("\n===== NOVA REPORT =====\n" + report)
    (OUT / "report.txt").write_text(report)

asyncio.run(main())
