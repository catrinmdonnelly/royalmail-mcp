# Parcel Toolkit for Royal Mail Click & Drop

Book, track and cancel Royal Mail and Parcelforce shipments by asking Claude. It uses your own Royal Mail Click & Drop account, so you need an API key from that account. It is made for people who are comfortable setting up developer tools, and it is not a product from Royal Mail.

## Set it up

Install the plugin in Claude Code. When you install it, Claude Code asks for your Click & Drop API key, which you can find under Settings then API credentials in Click & Drop. It keeps the key in your computer's secure storage.

It runs in Claude Code, and in Cowork sessions that run on your computer. Cowork cannot ask for your key, so there you would need to add the server by hand, following the [royalmail-mcp README](https://github.com/catrinmdonnelly/royalmail-mcp#readme). It does not run in Claude in the browser or the phone app, which only connect to servers on the web.

## What you can ask

- Book a Tracked 48 parcel to this address.
- Book these twenty orders from my spreadsheet.
- What is the status of this order?
- Cancel the order I made this morning.
- Which Royal Mail and Parcelforce services can I choose from?

## Labels need a business account

Booking, tracking and cancelling work on every Click & Drop account. Saving the postage label through the API only works for Royal Mail Online Business Accounts (OBA), the invoiced business account. On a standard account you can book through Claude and print the label from the Click & Drop website. The [royalmail-mcp README](https://github.com/catrinmdonnelly/royalmail-mcp#readme) explains the extra settings an OBA account needs.

## What it sends and where

- **To Royal Mail.** For each order you book, the names, addresses, phone numbers, weights and references go from your computer straight to Royal Mail's Click & Drop API at api.parcel.royalmail.com, using your API key.
- **On your computer.** Label files are saved to the `parcel-toolkit` folder inside your Downloads folder. They show your recipients' names and addresses, and so does `bookings.jsonl`, a running record of what has been booked. All of it stays there until you delete it.
- **To Parcel Toolkit or anyone else.** Nothing. There is no server of ours in the middle, and we do not see your orders or your key.
- **What it runs.** When Claude Code starts the plugin it runs `npx royalmail-mcp@0.2.1`, which downloads that exact version of the open source [royalmail-mcp](https://www.npmjs.com/package/royalmail-mcp) package from npm.

## Booking spends money

Booking and cancelling change your Click & Drop account, and a booking can cost you money. The plugin marks both as actions that change things, and Claude Code normally asks you to approve each one, though that depends on your own permission settings. Booking a list books every order in it in one go, up to 50 at a time, so check the list before you approve.

## Support and licence

Report problems at [github.com/catrinmdonnelly/royalmail-mcp/issues](https://github.com/catrinmdonnelly/royalmail-mcp/issues). MIT licence. Parcel Toolkit is not affiliated with Royal Mail or Parcelforce.
