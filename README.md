# MagOrder

Voice-based food ordering and table reservation system for restaurants. Customers call in, speak their order, and the system handles everything from speech recognition to order management -- powered by Twilio, Deepgram, and Anthropic.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | npm workspaces |
| **API** | Fastify 5, TypeScript, Node.js (ESM) |
| **Database** | PostgreSQL + Drizzle ORM |
| **Voice** | Twilio (calls & media streams) |
| **Speech-to-Text** | Deepgram (WebSocket streaming) |
| **AI** | Anthropic Claude API |
| **Frontend** | React 19, Vite 6, TypeScript |
| **Testing** | Vitest |
| **Validation** | Zod |

## Project Structure

```
magorder/
├── packages/
│   ├── api/                    # Backend API service
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts           # Database table definitions
│   │   │   │   ├── index.ts            # Drizzle ORM setup
│   │   │   │   └── seed.ts             # Sample data seeder
│   │   │   ├── routes/
│   │   │   │   ├── health.ts           # Health check
│   │   │   │   ├── twilio.ts           # Voice webhooks & media stream
│   │   │   │   ├── menu.ts             # Menu item endpoints
│   │   │   │   ├── orders.ts           # Order management
│   │   │   │   └── calls.ts            # Call session endpoints
│   │   │   ├── services/
│   │   │   │   └── stt.ts              # Deepgram speech-to-text
│   │   │   ├── lib/
│   │   │   │   └── call-manager.ts     # In-memory call session manager
│   │   │   ├── server.ts               # Fastify app setup
│   │   │   └── config.ts               # Environment config loader
│   │   ├── src/__tests__/              # Test suite
│   │   ├── drizzle.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   └── web/                    # Staff dashboard (React SPA)
│       ├── src/
│       │   ├── main.tsx
│       │   └── App.tsx
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── tsconfig.base.json          # Shared TypeScript config
├── .env.example                # Environment variable template
└── package.json                # Workspace root
```

## Prerequisites

- **Node.js** >= 18
- **PostgreSQL** running locally or remotely
- **Twilio** account (for voice calls)
- **Deepgram** account (for speech-to-text)
- **Anthropic** API key (for AI-powered conversations)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/annamalaiselvam/mag-order.git
cd mag-order
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/magorder
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
ANTHROPIC_API_KEY=your_anthropic_api_key
DEEPGRAM_API_KEY=your_deepgram_api_key
PORT=3000
WS_PORT=3001
NODE_ENV=development
```

### 3. Set up the database

```bash
# Generate migration files
npm -w packages/api run db:generate

# Apply migrations
npm -w packages/api run db:migrate

# Seed with sample menu items and tables
npm -w packages/api run db:seed
```

## Running Locally

**Start the API server** (with hot reload):

```bash
npm run dev:api
```

The API runs at `http://localhost:3000`.

**Start the web dashboard** (in a separate terminal):

```bash
npm run dev:web
```

The frontend runs at `http://localhost:5173` with API requests proxied to the backend.

**Build both packages for production:**

```bash
npm run build
```

## API Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check with status and timestamp |

### Menu

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/menu` | List all menu items |
| `GET` | `/api/menu/:id` | Get a single menu item |

### Orders

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orders` | List orders (newest first) |
| `GET` | `/api/orders/:id` | Get order with line items |
| `PATCH` | `/api/orders/:id` | Update order status |

### Calls

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/calls/active` | List active call sessions |
| `GET` | `/api/calls` | Last 50 call records |

### Twilio Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/twilio/voice` | Inbound call handler (TwiML) |
| `POST` | `/twilio/status` | Call status callback |
| `GET` | `/twilio/media-stream` | WebSocket for Twilio Media Streams |

## Database Schema

Six PostgreSQL tables managed by Drizzle ORM:

- **menuItems** -- Restaurant menu with name, description, price, and category (appetizers, mains, drinks, desserts)
- **orders** -- Customer orders with status tracking (pending -> confirmed -> preparing -> ready -> served)
- **orderItems** -- Line items linking orders to menu items with quantity and unit price
- **tables** -- Restaurant seating with capacity and location info
- **reservations** -- Table reservations with guest details, date, time slot, and party size
- **calls** -- Twilio call records linking call SIDs to orders

## Key Features

- **Voice ordering** -- Customers place orders by calling in; Twilio handles the phone connection and streams audio in real time
- **Speech-to-text** -- Deepgram transcribes caller speech via WebSocket with streaming results
- **Call session management** -- EventEmitter-based in-memory tracking of active calls with audio buffering
- **Order management** -- Full order lifecycle from creation through preparation to serving
- **Table reservations** -- Schema supports booking tables with time slots and party sizes
- **Staff dashboard** -- React frontend for restaurant staff (in development)

## Architecture

The system uses an event-driven architecture for voice interactions:

1. Customer calls the Twilio phone number
2. Twilio hits the `/twilio/voice` webhook, which responds with TwiML to greet the caller and open a media stream
3. Audio flows over WebSocket (`/twilio/media-stream`) in real time
4. The call manager tracks sessions and emits events as audio arrives
5. Deepgram's STT service transcribes the audio stream
6. Orders are created in PostgreSQL based on the conversation
7. Call status updates flow back through `/twilio/status`

## Testing

```bash
# Run all tests
npm -w packages/api run test

# Run in watch mode
npm -w packages/api run test:watch
```

The test suite covers API endpoints, call manager logic, Twilio webhook handling, STT service, error scenarios, and end-to-end call flows.

## License

Private project.
