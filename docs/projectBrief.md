# OpsPilot
## AI-Powered Maintenance & Service Operations SaaS
**Detailed Product Brief — Version 1.0**

**Product Type:** Business-to-Business (B2B) Software as a Service  
**Platform:** Responsive Web Application / Progressive Web App  
**Primary Users:** Maintenance managers, supervisors, technicians, inventory personnel, and business owners  
**Initial Industry:** Fleet, vehicle, and equipment maintenance  
**Development Budget:** $0 using open-source technologies and eligible free-tier services  
**Product Status:** Concept and specification planning

---

## 1. Executive Summary

OpsPilot is a centralized, AI-powered maintenance and service operations management platform designed to help organizations manage maintenance activities, employees, equipment, spare parts, and operational performance.

The platform replaces fragmented manual processes, spreadsheets, paper-based job cards, and disconnected communication with a structured digital workflow.

It allows businesses to monitor maintenance requests from initial reporting through assignment, repair, inspection, and final approval.

Unlike traditional maintenance tracking applications, OpsPilot incorporates AI-assisted workflows that help users generate structured maintenance requests, interpret operational data, summarize maintenance activities, and identify potential bottlenecks.

The system will follow a multi-tenant SaaS architecture, allowing multiple independent organizations to operate within the same application while maintaining separate and secure business data.

### Product Vision

To help businesses manage maintenance operations more efficiently through one intelligent, accessible, and organized platform.

### Product Mission

To reduce unnecessary equipment downtime, improve maintenance coordination, and provide managers with reliable operational information.

### Core Value Proposition

**One platform to manage work, assets, people, and maintenance decisions—with AI helping teams work more efficiently.**

---

## 2. Problem Statement

Small and medium-sized businesses frequently experience challenges managing maintenance activities because their operational processes are distributed across multiple systems or depend heavily on manual communication.

Common problems include:

1. Maintenance requests are reported verbally, through chat messages, or on paper.
2. Supervisors have difficulty tracking ongoing and unfinished jobs.
3. Technicians may receive assignments without complete maintenance information.
4. Spare parts availability is not consistently connected to work orders.
5. Business owners lack real-time visibility into operational performance.
6. Equipment maintenance histories are difficult to retrieve.
7. Preventive maintenance schedules may be overlooked.
8. Managers spend excessive time preparing daily operational reports.
9. Responsibilities and approvals are not always clearly documented.
10. Delays and recurring equipment problems are difficult to analyze.

### Proposed Solution

OpsPilot provides a unified system where maintenance activities are recorded, assigned, monitored, reviewed, and analyzed.

All relevant information becomes accessible through organization-specific dashboards, permission-controlled workflows, and AI-powered assistance.

---

## 3. Target Customers and Market

### Primary Customer Segment

Small and medium-sized organizations managing vehicles, machines, or equipment that require regular maintenance.

Examples include:

- Bus transportation companies
- Delivery and logistics companies
- Vehicle repair workshops
- Trucking and fleet operators
- Equipment maintenance contractors
- Equipment rental businesses

### Secondary Customer Segment

Future expansions can serve:

- Property management companies
- Building maintenance departments
- Hotels and resorts
- Schools and universities
- Manufacturing facilities
- Field service businesses

### Ideal Early Customer Profile

An organization that has multiple maintenance personnel, recurring equipment repairs, several assets to maintain, and a need for better work coordination.

The initial product should prioritize organizations that currently use spreadsheets, paper forms, or messaging applications to coordinate maintenance.

### Buyer vs. User

The **buyer** is typically the business owner, operations manager, or maintenance manager.

The **daily users** are supervisors, mechanics, technicians, and inventory personnel.

This distinction is important because buyers value visibility and reduced costs, while daily users need faster and simpler workflows.

---

## 4. Product Objectives

### Primary Objective

Develop a centralized AI-powered web platform that improves maintenance planning, work order management, operational visibility, and coordination among maintenance personnel.

### Specific Objectives

1. Enable organizations to manage equipment and maintenance records in a centralized database.
2. Provide a structured workflow for creating, assigning, monitoring, and completing maintenance tasks.
3. Track equipment condition, maintenance history, and operational availability.
4. Support preventive maintenance planning and reminders.
5. Provide inventory tracking for spare parts and maintenance materials.
6. Implement secure authentication and organization-based access permissions.
7. Generate dashboards and reports from operational records.
8. Integrate AI assistance for work order preparation, information retrieval, and maintenance summaries.
9. Support mobile-friendly workflows for personnel working in maintenance areas.
10. Maintain accountability through activity histories and approval records.

---

## 5. User Roles and Responsibilities

OpsPilot will support role-based access control (RBAC).

| User Role | Responsibilities |
|---|---|
| Platform Administrator | Manage the SaaS platform, system-level configurations, and account support |
| Organization Owner | Manage organizational settings, employees, roles, and business-level reporting |
| Maintenance Manager | Oversee maintenance operations, assignments, schedules, and performance |
| Supervisor | Review work orders, assign technicians, monitor work, and approve completed repairs |
| Technician / Mechanic | View assigned work, update progress, submit inspection results, and record repairs |
| Inventory Officer | Maintain spare parts records, process stock movements, and monitor inventory |
| Requester / Client | Submit service requests and track authorized request status; future phase |

### Authorization Requirements

Users must authenticate before accessing protected functionality.

Permissions must be verified on the server and in the database, not merely by hiding interface elements.

Users can belong to multiple organizations with different roles. Organization-specific records must remain isolated.

A technician must not be allowed to access another organization's work orders or approve their own repairs unless a specifically authorized workflow permits it.

---

## 6. Core System Modules

### Module 1: Organization and Workspace Management

**Purpose:** Support multiple independent business accounts.

Functional requirements:

- Create an organization workspace.
- Configure business name, logo, timezone, and operating details.
- Invite employees.
- Assign and update user roles.
- Activate or deactivate memberships.
- Switch between permitted organization workspaces.
- Define organization-specific maintenance settings.

Each organization acts as a separate logical tenant.

**Expected result:** Multiple businesses can use OpsPilot without exposing their data to each other.

### Module 2: Asset and Equipment Management

**Purpose:** Maintain a complete digital registry of equipment requiring maintenance.

Functional requirements:

- Register vehicles, machines, and other equipment.
- Assign a unique asset identifier.
- Store serial numbers, registration details, equipment categories, and locations.
- Track operational status.
- Attach equipment images and documentation.
- View historical repairs and inspections.
- Track mileage or operating hours where applicable.
- Generate QR labels linking to authenticated asset records.

Suggested asset statuses:

- Operational
- Under Maintenance
- Out of Service
- Pending Release
- Inactive

**Example:** Selecting Bus 102 displays its specifications, recent repairs, maintenance history, current issues, and outstanding work orders.

### Module 3: Maintenance Request and Work Order Management

**Purpose:** Digitize the full maintenance job lifecycle.

Functional requirements:

- Create corrective maintenance requests.
- Convert requests into formal work orders.
- Associate work orders with assets.
- Categorize repair types.
- Set priority and due dates.
- Assign supervisors and technicians.
- Attach images and relevant documents.
- Record maintenance activities and progress.
- Track required spare parts.
- Record labor and repair information.
- Submit completed jobs for supervisor review.
- Reopen work when corrections are needed.
- Maintain chronological work history.

**Suggested work order lifecycle:**

1. Draft
2. Open
3. Scheduled
4. In Progress
5. Blocked
6. Awaiting Review
7. Completed

A work order may also be canceled with an authorized reason.

Blocked jobs should record why work cannot proceed, such as unavailable parts, missing authorization, or unresolved technical problems.

A completed work order does not automatically mean the equipment is approved for operation.

### Module 4: Task Assignment and Workforce Management

**Purpose:** Improve maintenance coordination.

Functional requirements:

- Assign work orders to technicians.
- View employee assignments.
- Set task priorities.
- Record task start and completion times.
- Identify unassigned jobs.
- Monitor unfinished work.
- Reassign tasks when necessary.
- Display technician workloads.
- Record work notes and completion evidence.

An individual technician may work on multiple jobs, and one work order may involve multiple technicians.

**Expected result:** Supervisors can identify who is responsible for each active job.

### Module 5: Preventive Maintenance Management

**Purpose:** Support planned maintenance and reduce avoidable equipment failures.

Functional requirements:

- Create preventive maintenance templates.
- Define service intervals.
- Schedule inspections.
- Automatically generate scheduled maintenance tasks.
- Identify upcoming and overdue maintenance.
- Assign personnel.
- Record completed servicing.
- Maintain service history.

The initial version should support calendar-based schedules.

Mileage-based and operating-hour-based triggers can be added when reliable meter readings are available.

**Example:** A vehicle is scheduled for preventive maintenance every 30 days. OpsPilot identifies when the next service is due and generates a scheduled work order according to the organization's configured rules.

### Module 6: Inspection and Digital Checklists

**Purpose:** Standardize equipment inspections.

Functional requirements:

- Create inspection templates.
- Assign checklists to asset categories.
- Record pass, fail, or not-applicable results.
- Add remarks and image evidence.
- Flag defects.
- Generate corrective maintenance requests for failed inspection items.
- Record inspector identity and submission time.

**Example inspection checklist:**

- Brake condition
- Tire condition
- Fluid levels
- Fan belt condition
- Lighting system
- Electrical components
- Visible leaks
- General equipment condition

### Module 7: Spare Parts and Inventory Management

**Purpose:** Connect parts availability with maintenance activities.

Functional requirements:

- Create a spare parts catalog.
- Record part numbers and descriptions.
- Track quantities across stock locations.
- Set reorder thresholds.
- Search inventory availability.
- Reserve parts for work orders.
- Record parts issued, returned, received, or adjusted.
- Link part consumption to repairs.
- Track stock movements and responsible personnel.

Inventory updates must use secure database transactions to prevent incorrect stock balances when multiple users process items simultaneously.

Low-stock warnings should be based on defined thresholds rather than AI predictions.

### Module 8: Monitoring and Analytics Dashboard

**Purpose:** Give managers immediate visibility into maintenance performance.

Dashboard information:

- Total registered assets
- Operational and unavailable assets
- Open work orders
- Active maintenance jobs
- Blocked work orders
- Overdue maintenance
- Work orders awaiting approval
- Completed jobs within a selected period
- Spare parts below reorder levels
- Maintenance spending estimates where costs are recorded

Analytics features:

- Work order trends
- Completion turnaround times
- Equipment downtime
- Recurring maintenance problems
- Repairs by asset
- Technician workload
- Preventive versus corrective maintenance
- Parts consumption

Reports must use actual database records with consistent definitions and date ranges.

### Module 9: Notifications and Alerts

**Purpose:** Inform users of important operational changes.

Initial functionality:

- New assignment notifications
- Work order status changes
- Overdue maintenance alerts
- Approval requests
- Low-stock notices
- Supervisor review requests

The first version will use in-app notifications.

Email and external messaging integrations may be introduced later when the cost, reliability, and provider limits are understood.

### Module 10: Audit Logs and Activity History

**Purpose:** Create accountability and traceability.

Record important events such as:

- Work order creation
- Priority changes
- Assignment changes
- Status transitions
- Inventory adjustments
- Completion approvals
- Reopened work
- Permission changes

Each audit entry should identify the actor, organization, action, affected record, and timestamp.

Audit records must not be editable by ordinary organization users.

---

## 7. AI-Native Features

OpsPilot will combine deterministic business workflows with AI assistance.

AI must support employees rather than independently authorize safety-critical maintenance decisions.

### AI Feature 1: Natural-Language Work Order Creation

**User input:**

"Bus 102 has a damaged fan belt and needs replacement before it can operate again."

**Expected AI output:**

- Asset: Bus 102
- Maintenance category: Mechanical
- Reported problem: Damaged fan belt
- Suggested action: Inspect and replace the fan belt as appropriate
- Suggested priority: Requires supervisor evaluation
- Suggested status: Open

The AI output must be presented as an editable draft.

The user reviews the fields and confirms the creation of the work order.

The server validates the asset, organization, permissions, and required fields before saving.

### AI Feature 2: Operations Assistant

Authorized users may ask natural-language questions about organization data.

Example queries:

- Which vehicles currently have blocked work orders?
- What repairs were completed yesterday?
- Which assets have recurring problems?
- What maintenance tasks are overdue?
- Which work orders are waiting for spare parts?

The system retrieves permission-filtered data and produces a grounded answer.

Answers should reference their underlying records so that users can verify the information.

### AI Feature 3: Maintenance History Assistant

The assistant can summarize relevant historical maintenance records for an asset.

Example:

"Show previous repairs related to Bus 102's cooling system."

The system retrieves matching maintenance records and provides a summary.

It must distinguish documented facts from generated suggestions.

### AI Feature 4: Daily Operations Report Generator

The AI assists managers with generating readable summaries from verified operational statistics.

A daily report could contain:

- Maintenance jobs completed
- Newly reported issues
- Pending repairs
- Blocked work orders
- Equipment awaiting approval
- Identified operational delays

Numerical calculations must be performed by application logic or verified database queries.

The AI's primary responsibility is explaining the results.

### AI Feature 5: Maintenance Priority Assistant

The system can suggest priorities based on reported symptoms, equipment status, historical records, and organization rules.

Rule-based conditions must override AI recommendations where necessary.

The supervisor always retains final responsibility for approving priority and release decisions.

### Future AI Capabilities

Potential future developments include:

- Image-assisted defect description
- Document extraction from service records
- Maintenance procedure search
- Advanced anomaly detection
- Predictive maintenance, once sufficient quality historical data exists
- Multi-step AI workflows using authorized application tools

**AI Guardrails**

- Enforce tenant and user permissions before retrieving records.
- Never expose database credentials or unrestricted administrative tools to the model.
- Validate generated structured data using schemas.
- Require explicit user confirmation before important record changes.
- Treat uploaded documents and maintenance notes as untrusted inputs.
- Keep a record of AI-generated suggestions and approved actions.
- Provide normal manual workflows when the AI service is unavailable.
- Do not send confidential production data to AI services without appropriate data-handling arrangements.

---

## 8. Major Operational Workflows

### Workflow A: Corrective Maintenance

**Scenario:** A mechanic reports a vehicle problem.

1. A technician or requester submits a maintenance issue.
2. The platform records the request.
3. The supervisor reviews the problem and creates or approves a work order.
4. The supervisor sets priority and assigns personnel.
5. The technician begins work and updates progress.
6. Required parts are checked and issued through inventory.
7. The technician records completed activities.
8. The technician submits the job for review.
9. The supervisor inspects the submitted work.
10. The supervisor approves completion or returns the job for correction.
11. An authorized person separately approves the asset for operational release when required.
12. The system updates relevant histories, dashboards, and audit records.

### Workflow B: Preventive Maintenance

1. The manager defines a maintenance schedule.
2. The system identifies an upcoming service.
3. A scheduled maintenance work order is created.
4. The supervisor assigns technicians.
5. The technician performs the required checklist.
6. Issues discovered during inspection are recorded.
7. Additional corrective work orders are created when necessary.
8. The completed maintenance is reviewed.
9. The system calculates the next scheduled service.

### Workflow C: Parts Shortage

1. A technician identifies a required part.
2. The system checks available inventory.
3. If unavailable, the work order may be marked blocked.
4. The inventory officer receives an in-app notification.
5. The manager can review affected maintenance jobs.
6. When stock arrives, the inventory officer records receipt.
7. The supervisor resumes or reassigns the blocked work.

### Workflow D: AI-Assisted Daily Review

1. A manager opens the operations assistant.
2. The manager requests a daily maintenance summary.
3. The application retrieves authorized and relevant records.
4. Database logic calculates operational metrics.
5. The AI prepares a readable summary.
6. The manager reviews the results and linked records.
7. The manager may export or copy the report.

---

## 9. System Architecture

### Proposed Technology Stack

| Layer | Proposed Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Styling | Tailwind CSS |
| Component library | shadcn/ui |
| Routing | React Router |
| Data fetching | TanStack Query |
| Forms | React Hook Form |
| Validation | Zod |
| Database | PostgreSQL through Supabase |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL Row Level Security + server-side checks |
| Backend business logic | Supabase Edge Functions and database functions |
| File storage | Supabase Storage |
| Live updates | Supabase Realtime, selectively |
| AI integration | Gemini API through a server-side AI gateway |
| Local AI development | Ollama, where hardware permits |
| Hosting | Cloudflare Pages |
| Automated testing | Vitest and Playwright |
| Source control / CI | GitHub and GitHub Actions |

### Architecture Overview

**Presentation layer:** A responsive React application for managers, supervisors, technicians, and inventory personnel.

**Application layer:** Secure Edge Functions and database functions handle business logic, approvals, inventory transactions, and AI requests.

**Data layer:** PostgreSQL stores organizations, users, assets, maintenance records, inventory records, and activity logs.

**AI integration layer:** A server-side AI gateway manages model requests, authorization context, structured outputs, and response validation.

**Infrastructure layer:** Cloudflare serves the frontend while Supabase hosts the backend services.

### Design Approach

Start with a modular monolith rather than separate microservices.

Organize the application into independently maintainable modules with clear boundaries.

Use an API-first approach for sensitive operations so the application can later support native mobile clients, external integrations, or a different frontend.

---

## 10. Preliminary Database Design

The database will use a shared PostgreSQL database with logical tenant isolation.

### Main Entities

| Entity | Purpose |
|---|---|
| `organizations` | Business or tenant records |
| `profiles` | User profile information |
| `organization_members` | Organization memberships and roles |
| `sites` | Workshops, branches, or business locations |
| `assets` | Registered vehicles and equipment |
| `asset_meter_readings` | Mileage and operating-hour records |
| `maintenance_requests` | Reported problems |
| `work_orders` | Formal maintenance jobs |
| `work_order_assignments` | Assigned employees |
| `work_order_tasks` | Work order checklists and tasks |
| `work_order_events` | Status and activity history |
| `maintenance_plans` | Preventive maintenance schedules |
| `inspections` | Inspection submissions |
| `inspection_results` | Individual checklist results |
| `parts` | Spare parts catalog |
| `stock_locations` | Inventory storage locations |
| `inventory_movements` | Stock receipts, issues, returns, and adjustments |
| `work_order_parts` | Parts reserved or consumed by a job |
| `attachments` | References to uploaded files |
| `notifications` | In-app notifications |
| `audit_logs` | Security and operational audit records |
| `ai_runs` | AI requests, outcomes, and execution metadata |

### Data Relationships

- One organization has many members.
- One organization has many sites and assets.
- One asset can have many maintenance requests and work orders.
- One work order can have multiple assigned technicians.
- One work order can have multiple tasks and inventory transactions.
- One asset can have multiple maintenance schedules.
- One inspection contains multiple inspection results.
- One organization has many inventory items and stock locations.

### Data Integrity Requirements

- Use UUID primary keys where appropriate.
- Every tenant-owned record must contain an organization identifier.
- Enforce foreign keys and unique constraints.
- Use composite tenant-aware references where helpful.
- Enforce Row Level Security on exposed tenant data.
- Use transactions for inventory movements and critical workflow transitions.
- Store timestamps consistently in UTC and display them using organization settings.
- Use soft deletion or archiving where preserving maintenance history is important.

---

## 11. UI/UX Design Brief

### Design Direction

OpsPilot should use a clean, professional interface appropriate for operational business software.

The design should prioritize:

- Fast access to maintenance information
- Readable tables and statuses
- Clear task ownership
- Minimal data-entry friction
- Consistent navigation
- Responsive desktop and mobile layouts
- Accessible colors and controls
- Clear confirmation and error messages

### Primary Navigation

1. Dashboard
2. Maintenance Requests
3. Work Orders
4. Assets
5. Preventive Maintenance
6. Inspections
7. Inventory
8. Team
9. Reports and Analytics
10. AI Assistant
11. Notifications
12. Settings

Modules can be hidden or restricted according to user permissions.

### Important Screens

**Dashboard:** KPI cards, maintenance trends, urgent work orders, blocked jobs, and pending approvals.

**Work Order Board:** Table and Kanban views with filters by status, priority, assignee, and asset.

**Work Order Detail:** Job information, status, assigned personnel, checklists, parts, attachments, and chronological activity history.

**Asset Profile:** Equipment specifications, operating status, maintenance schedules, and repair history.

**Technician Workspace:** A mobile-friendly list of assigned jobs, checklist actions, progress updates, and evidence uploads.

**AI Assistant:** A conversational interface with verified results, linked records, draft previews, and confirmation controls.

### Visual Design

Suggested visual identity:

- Primary: Deep navy
- Accent: Blue or teal
- Neutral: White and slate gray
- Success: Green
- Warning: Amber
- Critical: Red

Color must not be the only method of communicating a status.

Use consistent typography, spacing, icons, and reusable components throughout the application.

---

## 12. Security and Non-Functional Requirements

### Security

- Authenticated access to protected records.
- Tenant-isolated database access using RLS.
- Server-side role and permission checks.
- Restricted file upload types and sizes.
- Private storage buckets for business documents.
- Secure handling of API secrets.
- Input validation and output escaping.
- Protection against common web vulnerabilities.
- Audit logging for sensitive operations.
- Rate limits for AI requests and sensitive endpoints.
- Tests for unauthorized cross-tenant access.
- No client-side exposure of privileged service credentials.

### Performance

The product should be designed to:

- Provide responsive navigation.
- Paginate long work order and asset lists.
- Avoid unnecessary database queries.
- Minimize expensive real-time subscriptions.
- Support reasonable operation over mobile connections.
- Provide clear loading, empty, and error states.

Performance targets should be measured during testing rather than assumed.

### Reliability

- Validate work order state transitions.
- Prevent duplicate inventory movements.
- Handle repeated requests safely through idempotency where needed.
- Provide clear feedback when operations fail.
- Preserve changes using appropriate transactions.
- Ensure the core application remains usable if AI features fail.

### Accessibility

Target WCAG 2.2 Level AA where practical, including keyboard support, readable contrast, labeled controls, and accessible error messages.

### Data Protection

Use synthetic records during initial development.

Real business data should only be introduced with appropriate authorization and adequate privacy, security, retention, and recovery measures.

A free hosted database without managed automatic backups must not be treated as a complete production disaster-recovery solution.

---

## 13. Minimum Viable Product (MVP)

The MVP should deliver one complete operational workflow before introducing every planned feature.

### MVP Scope — Required

**Authentication and Organization**
- Registration and login
- Organization creation
- Member invitations
- Initial RBAC

**Asset Management**
- Asset registration
- Asset listing and details
- Equipment status
- Maintenance history

**Work Order Management**
- Work order creation
- Priority and status management
- Assignment
- Technician updates
- Supervisor review
- Completion history

**Dashboard**
- Asset counts
- Active and completed work orders
- Blocked work orders
- Pending approvals

**Security**
- Tenant isolation
- Role-based authorization
- Essential audit records

**Initial AI Capability**
- Natural-language work order draft generation with human confirmation

### MVP Acceptance Criteria

The initial version is acceptable when:

1. A business owner can register and create an organization.
2. The owner can invite a supervisor and technician.
3. A supervisor can register a vehicle or equipment asset.
4. A maintenance issue can become an assigned work order.
5. The technician can view and update the assigned job.
6. The supervisor can approve or reject completed work.
7. The dashboard reflects the updated work order information.
8. The AI can convert an issue description into a validated editable draft.
9. Unauthorized users cannot access another organization's records.
10. The entire workflow works without requiring the AI service.

### Excluded from the First Release

- Subscription billing
- Native Android and iOS applications
- GPS fleet tracking
- Full enterprise resource planning
- Automated equipment diagnosis
- Predictive maintenance models
- Complex offline synchronization
- External fleet telematics integrations
- Automated purchasing
- Autonomous AI approval of completed maintenance

---

## 14. Development Roadmap

### Phase 0: Discovery and Validation

**Deliverables:**
- Problem validation with potential users
- Defined customer persona
- Confirmed maintenance workflow
- Requirements and business rules
- Product scope and acceptance criteria

### Phase 1: System Foundation

**Deliverables:**
- Repository and development setup
- Database schema and migrations
- Authentication
- Organization onboarding
- Tenant isolation
- Role-based permissions
- Basic design system

### Phase 2: Core Operations MVP

**Deliverables:**
- Asset registry
- Work orders
- Task assignments
- Technician updates
- Supervisor approvals
- Activity history
- Management dashboard

**Milestone:** A complete maintenance process operates without AI.

### Phase 3: Initial AI Integration

**Deliverables:**
- AI integration gateway
- Natural-language work order generation
- Structured output validation
- Approval workflow
- AI usage monitoring
- Error and fallback handling

### Phase 4: Maintenance Operations Expansion

**Deliverables:**
- Preventive maintenance schedules
- Digital inspection checklists
- Spare parts management
- Inventory transactions
- In-app notifications

### Phase 5: Business Intelligence

**Deliverables:**
- Performance reporting
- Operational analytics
- AI daily summaries
- Maintenance history assistant
- Report exporting

### Phase 6: SaaS Hardening and Portfolio Launch

**Deliverables:**
- End-to-end tests
- Permission and security tests
- Mobile responsiveness improvements
- Accessible UI review
- Performance testing
- Demo data
- Documentation
- Landing page
- Public demonstration
- Portfolio case study

---

## 15. Example End-to-End Demonstration

### Scenario: Bus 102 Requires Fan Belt Replacement

**Step 1 — Report**

A technician reports that Bus 102 has a damaged fan belt.

**Step 2 — AI Assistance**

OpsPilot converts the written issue into a proposed maintenance work order.

The technician or supervisor reviews and confirms the generated information.

**Step 3 — Supervisor Assignment**

The supervisor assigns the work order to an available mechanic.

**Step 4 — Parts Verification**

The inventory module identifies whether the required fan belt is available.

**Step 5 — Maintenance**

The mechanic records the replacement work, relevant observations, and completion evidence.

**Step 6 — Review**

The supervisor checks the submitted work and approves the completed work order.

**Step 7 — Operational Release**

A separately authorized employee confirms that the vehicle is safe and ready for operational release in accordance with company procedures.

**Step 8 — Reporting**

OpsPilot updates maintenance history and the dashboard.

A manager can ask:

"What maintenance was completed on Bus 102 today?"

The AI assistant retrieves the authorized records and produces a summary.

This demonstration should become the flagship workflow in the portfolio.

---

## 16. Success Metrics

Product effectiveness should be assessed using real measurements from pilot users.

### Operational Metrics

- Average work order completion time
- Number of overdue work orders
- Percentage of maintenance jobs completed
- Average equipment downtime
- Number of recurring faults
- Preventive maintenance completion rate
- Number of blocked work orders
- Time spent preparing daily reports

### Product Usage Metrics

- Active organizations
- Active employees
- Work orders created
- Completed work orders
- Weekly active users
- AI draft acceptance rate
- AI request failure rate
- Commonly used modules

### Technical Quality Metrics

- Application error rate
- Work order operation success rate
- Automated test coverage
- Security test results
- Response-time measurements
- Zero known unauthorized cross-tenant access paths in tested scenarios

Initial targets should be established after usability testing and baseline measurements.

---

## 17. Commercialization Strategy

The first objective is to create a credible portfolio product and validate its usefulness.

### Initial Strategy

1. Develop the functional MVP.
2. Create realistic synthetic business data.
3. Demonstrate a complete maintenance workflow.
4. Interview potential business users.
5. Observe how supervisors and technicians manage actual work.
6. Refine the product based on feedback.
7. Seek a limited pilot with a willing organization.
8. Evaluate commercial readiness before accepting production-critical operations.

### Potential Future Subscription Model

**Starter:** Asset management and basic work orders.

**Professional:** Preventive maintenance, inventory, reports, and expanded team management.

**Business:** AI operations features, advanced analytics, multiple sites, and integrations.

Specific pricing should be established through customer research and infrastructure cost analysis rather than assumed at this stage.

---

## 18. Risks and Constraints

| Risk | Mitigation |
|---|---|
| Free-tier resource limits | Usage monitoring, quotas, and efficient queries |
| Free-tier project inactivity | Regular maintenance and clear demo availability expectations |
| AI API limits | Request caps, fallback behavior, and manual workflows |
| Incorrect AI-generated suggestions | Schema validation and human approval |
| Cross-tenant data exposure | RLS, authorization tests, and secure architecture |
| Complex scope | Strict MVP prioritization and phased releases |
| Inventory inconsistencies | Transactional stock operations |
| Unreliable operational records | Required fields, audit history, and clear validation |
| Missing managed backups | Export strategy and a paid recovery plan before production |
| Low user adoption | Simple workflows and early user testing |

---

## 19. Long-Term Product Direction

OpsPilot can evolve into a broader service operations platform supporting multiple industries through configurable modules.

Potential future capabilities include:

- Customer service portals
- Branch-level reporting
- Advanced scheduling
- Maintenance cost forecasting
- Parts procurement workflows
- Fleet telematics integrations
- Enterprise reporting
- Business-specific workflow builders
- AI-assisted operational planning
- External developer APIs
- Additional mobile and offline capabilities

Future expansion should depend on demonstrated customer demand and operational feasibility.

---

## 20. Final Product Definition

**OpsPilot is an AI-native, multi-tenant maintenance and service operations SaaS designed to help organizations manage assets, technicians, work orders, preventive maintenance, spare parts, and operational reporting within a secure centralized platform.**

The core system will use structured business workflows and reliable database operations, while AI provides contextual assistance through natural-language inputs, authorized record retrieval, and intelligent summaries.

The initial version will focus on maintenance management for fleet and equipment operators, with an architecture that supports future expansion into other service industries.

**Primary development principle:** Build a reliable business application first, integrate AI where it creates measurable value, and expand only after the core workflow has been validated.

**Initial deliverable:** A working, multi-tenant, AI-assisted maintenance management application that demonstrates modern full-stack engineering and solves a recognizable business problem.