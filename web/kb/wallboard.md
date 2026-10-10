# Wallboards and TV links

The wallboard is a floor display: team leaderboard, team totals, the active challenge, kudos as they land, and a moment card when something worth celebrating happens.

## Putting it on a TV

A TV cannot sign in, so the wallboard uses a link that carries its own key.

1. In the supervisor console, choose **TV link**.
2. Arena creates a key, valid for 90 days, and copies a wallboard link to your clipboard.
3. Paste the link into the TV's browser. It needs no sign-in.

The link is read-only. It shows the leaderboard, challenges and kudos feed for that team and nothing else. Supervisors can list and revoke keys through the API, and a revoked key stops working at once.

## Controlling how names appear

Anyone walking past can read a TV. The stack's **WallboardNames** setting controls how people appear on wallboards:

- `full`: the name as in Connect.
- `first`: first name and last initial, such as "Priya N."
- `initials`: initials only.

Signed-in pages always show full names. Usernames are never sent to wallboards.

## Opening it signed in

Supervisors can also open **Open wallboard** from the console, which uses their sign-in instead of a key.
