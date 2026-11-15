# Discord server setup

`rusnipez discord-setup` applies everything the bot can: channels, their order, topics, slow
mode, permissions, @everyone's permissions, and the messages in #welcome, #rules, #how-to and
#wins. Run it on the server after a deploy that changes `src/rusnipez/bot/layout.py` or
`pages.py`:

```bash
docker compose -f compose.yaml -f compose.prod.yaml exec -T service rusnipez discord-setup
```

The rest needs **Manage Server**, which the bot deliberately does not have. The owner sets it
once, in Discord, in this order. Discord moves menus around now and then; if a name below
does not match, search Server Settings for it.

## 1. Basics (Server Settings)

| Where | Set to | Why |
|---|---|---|
| Overview › Default Notification Settings | **Only @mentions** | Otherwise every member is notified of every message, including #live-openings |
| Safety Setup › Verification Level | **Medium** | Verified email and an account older than 5 minutes |
| Safety Setup › Explicit image filter | **Filter messages from all members** | |
| Safety Setup › Require 2FA for moderator actions | **On** | A stolen mod account cannot ban everyone |
| Roles › Mod › Permissions | add **Timeout Members**, **Kick Members**, **Ban Members** | The bot can only give Mod what it has itself |

## 2. Enable Community

Server Settings › **Enable Community** › Get started.

- Rules or guidelines channel: **#rules**
- Community updates channel: **#mod** (Discord's notices for admins; members cannot see it)

Then, in Server Settings › Channels, open **#announcements** and turn on **Announcement
Channel**, so people can follow it. Only staff can post there already.

## 3. Rules screening

Server Settings › Safety Setup (or Onboarding › Safety Check) › turn on **Members must accept
rules before they can talk or DM**. Add these rules, one per line. They are the short form of
#rules:

1. Be kind. No harassment, hate speech or personal attacks.
2. No spam, ads or server invites.
3. No buying, selling or trading seats.
4. Never share your NetID, password or Duo codes. RU SnipeZ will never ask.
5. Use the right channel: #support for problems, #bot-commands for commands.
6. Follow Discord's Terms and Community Guidelines.

## 4. Onboarding

Server Settings › **Onboarding**.

- **Default channels:** all of Start here, Sniping and Community. Discord needs at least 7,
  with 5 members can post in: #bot-commands, #general, #wins, #support and #feedback.
- **Questions:** none. Nothing here needs a role yet.
- **Server Guide › Welcome message:**
  > Class full? RU SnipeZ DMs you the moment a seat opens. Start with the three to-dos below;
  > it takes about a minute.
- **Server Guide › New member to-dos:**

  | To-do | Channel |
  |---|---|
  | Read how it works | #how-to |
  | Snipe your first section | #bot-commands |
  | Say hi | #general |
- **Server Guide › Resource pages:** #how-to and #rules.

## 5. AutoMod

Server Settings › **AutoMod**:

- **Block mention spam:** on, limit 5, block the message and time out for 10 minutes.
- **Block suspected spam content:** on.
- **Block commonly flagged words:** on, all three lists.
- **Custom keyword rule** "Invites and scams": block `discord.gg/*`, `discord.com/invite/*`,
  `*free nitro*`, `*steamcommunity*`. Allow the role **Mod**.

## 6. Screenshots for #how-to

Each step in #how-to can show a picture. Take them in the real server, crop to the part that
matters, and blur usernames other than the bot's.

| File | Shows |
|---|---|
| `find.png` | WebReg or the Schedule of Classes with a section's 5-digit index visible |
| `snipe.png` | Typing `/snipe 12345` in #bot-commands, and the reply |
| `alert.png` | The alert DM with Register, Snooze 1h, Stop watching and I got in |
| `dms.png` | Right-click server › Privacy Settings with Direct Messages on |
| `check.png` | The `/check` reply |

To add them:

1. Put the files in `web/public/discord/`. The website serves them, and Vercel deploys them
   with `main`.
2. List each one in `SCREENSHOTS` in `src/rusnipez/bot/pages.py`, for example
   `{"snipe": "snipe.png"}`.
3. Deploy the service and run `discord-setup`. It edits the #how-to message in place.

A step without a listed file shows no picture, so this can be done one screenshot at a time.
