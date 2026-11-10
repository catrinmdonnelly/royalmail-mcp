# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-11-09

### Added
- Every tool now has a title and a read-only or destructive label, which Claude's directory requires. Booking and cancelling are marked destructive, which some clients use when deciding whether to ask you first. The label is advice to the client, not something this server enforces.
- The MCP Registry name `io.github.catrinmdonnelly/royalmail-mcp`.

### Changed
- `.env.example` is no longer published to npm. The README lists the settings, and the file is still in the repository.

### Fixed
- `cancel_order` now reports a failure when Royal Mail refuses the cancellation. Before, it always said it had worked.
- A label that is not a PDF is rejected instead of being saved.
- On accounts that cannot save labels through the API (anything other than an Online Business Account), batch booking still books and reports the orders, and says to print the labels from Click & Drop.
- Batch booking now records every booking before it fetches any label. Before, a label that could not be fetched made a parcel that was already booked look like a failure, so asking again would have booked it twice. Booked parcels are always reported, with a note on any that have no saved label.
- Labels are saved only inside the labels folder. File names and extensions built from carrier or user text are cleaned, existing files are never overwritten, and files are readable by you only.
- Waybills and order identifiers are checked before they go into a web address, so a crafted value cannot reach a different carrier endpoint.
- Text from the carrier is cleaned and cut short before Claude sees it, including error messages, tracking events and order status.
- The carrier address must be https (plain http only for localhost), requests time out after 30 seconds, and redirects are refused so credentials cannot be sent elsewhere.
- Settings passed in by the MCP client now win over the `.env` file.
- A batch is limited to 50 shipments.
- Every booking is written to `bookings.jsonl` in the labels folder as it happens, so a batch cut short by the client still leaves a record of what was booked.
- One label that cannot be read no longer loses the merge for the others.
- A failure that may have happened after the carrier accepted the booking (a timeout, a connection drop, a server error) now says so, so Claude checks before booking again.
- Dates are checked: only YYYY-MM-DD or DD/MM/YYYY, and only real dates. Before, `12/11/2026` could be read as 11 December in Royal Mail bookings.
- Invisible and direction-changing characters are removed from carrier text, and values such as waybills are cleaned too.
- Tool descriptions no longer promise defaults or inputs that the tools do not have. `book_order` now accepts raw Service Register codes as its description said.
- The service list says the tools book UK addresses only.
- Order identifiers must be numbers, so a shared order reference can no longer be passed to cancel or track.
- Asking about an order that does not exist is now an error, not an empty success.

### Security
- Updated `@modelcontextprotocol/sdk` to 1.32.2 and `zod` to 4.6.7, and refreshed the packages they bring in, including `proxy-addr`, `body-parser`, `fast-uri`, `hono`, `ip-address` and `qs`. `npm audit` now reports no findings.

## [0.2.0] - 2026-04-24

### Added
- New `book_batch_and_label` tool: book many Royal Mail orders in one call and get back a single merged PDF of every label, ready to print. All orders share the same service, package format and sender.
- `get_label` now saves the label to disk and returns a file path instead of a base64 string in JSON. Default location: `~/Downloads/parcel-toolkit/`, overridable via `PARCEL_TOOLKIT_LABELS_DIR`.
- New dependency: `pdf-lib` for merging PDFs.

### Changed
- **Breaking:** `get_label` response shape changed. Old response had `labelBase64`; new response has `filePath`. The label file is written to disk as part of the call. Callers expecting the base64 payload should either read the file from `filePath` or pin to `0.1.x`.

### Fixed
- `createOrder` now includes `unitWeightInGrams` when building the `contents` array from `goodsDescription`. Without it, Click & Drop's API rejected the booking with *"When value 'SKU' is not provided values 'UnitValue' and 'UnitWeightInGrams' are required."* This bug blocked any booking that passed `goodsDescription`.

## [0.1.0] - 2026-04-22

### Added
- Initial release.
- Five MCP tools: `book_order`, `get_label`, `track_order`, `cancel_order`, `list_services`.
- Friendly keys for 33 Royal Mail and Parcelforce services (UK 1st/2nd Class, Tracked 24/48, Special Delivery, Parcelforce express, international).
- Raw Service Register codes (`OLP1`, `TOLP24`, `PFE48`, etc.) also accepted at booking.
- Verified against the live Click & Drop API on 2026-04-22: booking, tracking and cancellation tested end-to-end on a real account; label retrieval verified against spec for OBA accounts.
