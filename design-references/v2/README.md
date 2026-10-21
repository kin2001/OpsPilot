# OpsPilot — Version 2 design references

Twelve main pages and one matching logo, generated with the built-in imagegen tool. This is a raster reference set, not an implemented application. Version 1 is preserved separately.

## View the set

[Open visual gallery](index.html)

- [Dashboard](01-dashboard.png)
- [Requests](02-requests.png)
- [Work orders](03-work-orders.png)
- [Assets](04-assets.png)
- [Maintenance](05-maintenance.png)
- [Inspections](06-inspections.png)
- [Inventory](07-inventory.png)
- [Team](08-team.png)
- [Reports](09-reports.png)
- [Assistant](10-assistant.png)
- [Notifications](11-notifications.png)
- [Settings](12-settings.png)
- [Transparent logo](00-opspilot-logo.png)
- [Full prompt set](prompts.md)
- [Image dimensions and source manifest](manifest.json)

## Design direction

Warm white canvas, light stone navigation, charcoal typography and cobalt actions. The repeated sidebar, logo, typography, spacing, tables, status labels and controls provide continuity. Task-specific layouts vary: board for work, calendar for maintenance, tables for records, inbox for notifications and conversation for the assistant.

The requested [Dribbble article](https://dribbble.com/stories/2019/02/15/what-defines-good-ui-design) informed the focus on clear priorities, content grouping, usability and a recognizable brand. These are design choices, not evidence of user testing.

Intent palette: canvas #FAF9F6, sidebar #F0F0EB, ink #202623, action #2855D9, rules #DDDFD9. Generated pixels may vary. Implementation should use explicit shared tokens and components.

## Scope and limitations

- Main navigation only: dashboard, requests, work orders, assets, maintenance, inspections, inventory, team, reports, assistant, notifications and settings.
- No separate detail, creation, mobile, authentication, onboarding or administrator pages are included.
- Some main screens use inline previews. These are part of the index-page layout.
- The logo is a transparent raster PNG, not vector artwork. Transparency was verified.
- Desktop 3840 x 2160 was requested but the generator returned approximately 1672 x 941; exact dimensions are in manifest.json. The images have not been upscaled.
- All business data and contact details are illustrative. Generated copy, totals, record IDs and roles are not a reconciled dataset and should not be copied as business logic or production data.
- Visual consistency was inspected. Keyboard navigation, contrast compliance, responsive behavior and application functionality cannot be verified from these images.

