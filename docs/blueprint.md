# **App Name**: OPEC OpsFlow

## Core Features:

- User Authentication & Access Control: Secure user authentication using Firebase Auth and role-based access enforcement. Roles and permission profile ids are stored in **lowercase snake_case** (`assignedRoleKey`, `permissionProfileKey`, `accessGroup` such as `operations`) and enforced consistently in Firestore rules and the User Access Management UI.
- Role-Based Navigation & UI Shell: A responsive application shell with dynamic sidebar navigation tailored to the user's assigned role. UI elements for Phase 1A modules will display Thai labels first, conforming to `shadcn/ui` components.
- Core Data Management (CRUD): Comprehensive Create, Read, Update, and Delete (CRUD) screens for essential Phase 1A entities: Users, Roles, Positions, Position Requirements (Certificates, PPE, Tools), Workers, Worker Certificates, Worker Medical Records, and Worker Drug Tests. All data is persisted in Firestore.
- Worker Readiness Logic: Automated calculation and clear display of each worker's readiness status, based on the completion and validity of their certificates, medical records, and drug test results, compared against required position matrices.
- Audit Logging: Automatic and immutable logging of all 'Create', 'Update', and 'Delete' operations across key Firestore entities to an 'audit_logs' collection, providing historical activity tracking.
- Position Requirements Assistant: An AI-powered tool to assist HR Managers in generating standardized, clear, and concise descriptions for 'position certificate requirements', 'position PPE requirements', and 'position tool requirements' based on minimal input.
- Initial Data Seeding: A utility for system administrators to seed the Firestore database with initial mock data, including six predefined staff users, essential roles, and sample positions for development and testing purposes.

## Style Guidelines:

- The primary brand color, a deep and professional indigo blue, is '#2E2E5C' (HSL: 240, 40%, 30%). This communicates reliability and seriousness suitable for operational management.
- The main background color, a very light off-white with a subtle cool tint, is '#F6F6FA' (HSL: 240, 20%, 95%), ensuring high readability and a clean interface.
- An accent color of clear medium blue, '#4C7FCC' (HSL: 210, 60%, 50%), will be used for interactive elements and highlights, providing clear visual contrast while remaining professional.
- The primary font for all text, including headlines and body, will be 'Inter' (grotesque-style sans-serif) for its modern, legible, and objective characteristics across diverse content, including Thai characters.
- Utilize a consistent suite of minimalist, vector-based icons, ideally from Lucide Icons, to provide clear and intuitive visual cues for navigation, actions, and data statuses throughout the application.
- A structured and responsive layout centered around a fixed-width sidebar for primary navigation and a spacious main content area for forms and data tables. Emphasizes clear organization and accessibility of information.
- Subtle and functional UI animations will be implemented to provide immediate user feedback on actions, smooth page transitions, and indication of data loading, enhancing perceived application responsiveness without distraction.