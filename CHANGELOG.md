# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-22

### Added
- Initial release.
- Five MCP tools: `book_order`, `get_label`, `track_order`, `cancel_order`, `list_services`.
- Friendly keys for 33 Royal Mail and Parcelforce services (UK 1st/2nd Class, Tracked 24/48, Special Delivery, Parcelforce express, international).
- Raw Service Register codes (`OLP1`, `TOLP24`, `PFE48`, etc.) also accepted at booking.
- Verified against the live Click & Drop API on 2026-04-22: booking, tracking and cancellation tested end-to-end on a real account; label retrieval verified against spec for OBA accounts.
