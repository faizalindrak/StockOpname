# Recurring Sessions - Cron Job Setup

## Overview

This document explains how to set up automated tasks for the recurring sessions feature. These tasks handle:
1. **Activating scheduled sessions** - Makes sessions visible to users on their scheduled date
2. **Auto-closing expired sessions** - Closes sessions that have passed their `valid_until` time
3. **Generating recurring sessions** - Creates new sessions from recurring templates

---

## Option 1: Using PostgreSQL pg_cron Extension (Recommended)

### Step 1: Enable pg_cron Extension

Run this in a PostgreSQL client connected to the application database:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Step 2: Schedule Daily Jobs

Run these commands to create scheduled jobs:

```sql
-- Job 1: Activate sessions scheduled for today (runs every hour)
SELECT cron.schedule(
    'activate-scheduled-sessions',
    '0 * * * *', -- Every hour at minute 0
    $$
    SELECT public.activate_scheduled_sessions();
    $$
);

-- Job 2: Auto-close expired sessions (runs every 5 minutes)
SELECT cron.schedule(
    'auto-close-expired-sessions',
    '*/5 * * * *', -- Every 5 minutes
    $$
    SELECT public.auto_close_expired_sessions();
    $$
);

-- Job 3: Generate recurring sessions (runs daily at midnight)
SELECT cron.schedule(
    'generate-recurring-sessions',
    '0 0 * * *', -- Daily at midnight
    $$
    SELECT public.generate_recurring_sessions(id, 30)
    FROM sessions
    WHERE is_recurring_template = true
        AND status = 'active';
    $$
);
```

### Step 3: Verify Jobs

Check that jobs are scheduled:

```sql
SELECT * FROM cron.job;
```

### Step 4: View Job Logs

Monitor job execution:

```sql
SELECT *
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 20;
```

### Managing Jobs

**Unschedule a job:**
```sql
SELECT cron.unschedule('activate-scheduled-sessions');
```

**Update job schedule:**
```sql
-- First unschedule
SELECT cron.unschedule('job-name');

-- Then reschedule with new timing
SELECT cron.schedule(...);
```

---

## Option 2: Using External Cron (Server-based)

If you can't use pg_cron, you can set up external cron jobs that connect to PostgreSQL with `DATABASE_URL` and run the same functions.

### Step 1: Create API Endpoint

Create a serverless function or API endpoint (e.g., Vercel, Netlify, AWS Lambda):

```javascript
// api/cron/recurring-sessions.js
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Activate scheduled sessions
    const activated = await pool.query('SELECT * FROM public.activate_scheduled_sessions()');

    // 2. Auto-close expired sessions
    const closed = await pool.query('SELECT * FROM public.auto_close_expired_sessions()');

    // 3. Generate recurring sessions
    const templates = await pool.query(
      `SELECT id FROM sessions WHERE is_recurring_template = true AND status = 'active'`
    );

    const generateResults = [];
    for (const template of templates.rows) {
      const result = await pool.query(
        'SELECT * FROM public.generate_recurring_sessions($1, $2)',
        [template.id, 30]
      );
      generateResults.push(result.rows);
    }

    return res.status(200).json({
      success: true,
      activated: activated.rowCount,
      closed: closed.rowCount,
      generated: generateResults
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({ error: error.message });
  }
}
```

### Step 2: Set Up Cron Triggers

**Using Vercel Cron Jobs** (add to `vercel.json`):

```json
{
  "crons": [
    {
      "path": "/api/cron/recurring-sessions",
      "schedule": "0 * * * *"
    }
  ]
}
```

**Using GitHub Actions** (`.github/workflows/cron.yml`):

```yaml
name: Recurring Sessions Cron

on:
  schedule:
    - cron: '0 * * * *' # Every hour

jobs:
  run-cron:
    runs-on: ubuntu-latest
    steps:
      - name: Call cron endpoint
        run: |
          curl -X POST https://your-domain.com/api/cron/recurring-sessions \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

**Using cron-job.org** (Web service):
1. Go to https://cron-job.org
2. Create account and add new cron job
3. URL: `https://your-domain.com/api/cron/recurring-sessions`
4. Add header: `Authorization: Bearer YOUR_CRON_SECRET`
5. Schedule: Every hour

---

## Option 3: Manual Execution (Development/Testing)

For development or testing, you can manually run the functions:

### In PostgreSQL client:

```sql
-- Activate scheduled sessions
SELECT * FROM public.activate_scheduled_sessions();

-- Auto-close expired sessions
SELECT * FROM public.auto_close_expired_sessions();

-- Generate recurring sessions for a specific template
SELECT * FROM public.generate_recurring_sessions(
  'your-template-uuid-here'::UUID,
  30 -- days ahead
);

-- Generate for all active templates
SELECT
  t.id,
  t.name,
  r.*
FROM sessions t
CROSS JOIN LATERAL public.generate_recurring_sessions(t.id, 30) r
WHERE t.is_recurring_template = true
  AND t.status = 'active';
```

### In JavaScript/Frontend (for testing through the Hono compatibility API):

```javascript
// In Admin Dashboard
const runCronJobs = async () => {
  try {
    // Activate scheduled sessions
    const { data: activated } = await supabase
      .rpc('activate_scheduled_sessions');
    console.log('Activated:', activated);

    // Auto-close expired
    const { data: closed } = await supabase
      .rpc('auto_close_expired_sessions');
    console.log('Closed:', closed);

    // Generate recurring
    const { data: templates } = await supabase
      .from('sessions')
      .select('id, name')
      .eq('is_recurring_template', true)
      .eq('status', 'active');

    for (const template of templates) {
      const { data: result } = await supabase
        .rpc('generate_recurring_sessions', {
          p_master_session_id: template.id,
          p_days_ahead: 30
        });
      console.log(`Generated for ${template.name}:`, result);
    }

    alert('Cron jobs executed successfully!');
  } catch (error) {
    console.error('Error:', error);
    alert('Error running cron jobs: ' + error.message);
  }
};
```

---

## Recommended Schedule

| Task | Frequency | Reason |
|------|-----------|--------|
| `activate_scheduled_sessions` | Every hour | Sessions can become visible throughout the day |
| `auto_close_expired_sessions` | Every 5 minutes | Quick response when session expires |
| `generate_recurring_sessions` | Daily at midnight | Prepare sessions for the next 30 days |

---

## Monitoring & Troubleshooting

### Check Generated Sessions

```sql
-- View all scheduled sessions for the next 7 days
SELECT
  s.id,
  s.name,
  s.status,
  s.scheduled_date,
  s.valid_from,
  s.valid_until,
  p.name as parent_template
FROM sessions s
LEFT JOIN sessions p ON p.id = s.parent_session_id
WHERE s.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
ORDER BY s.scheduled_date;
```

### Check Recurring Logs

```sql
-- View generation logs
SELECT
  l.*,
  m.name as master_name,
  g.name as generated_name
FROM recurring_session_logs l
JOIN sessions m ON m.id = l.master_session_id
JOIN sessions g ON g.id = l.generated_session_id
ORDER BY l.created_at DESC
LIMIT 50;
```

### Check Active Templates

```sql
-- View all recurring templates
SELECT
  id,
  name,
  recurring_config,
  valid_from::TIME as start_time,
  valid_until::TIME as end_time,
  status
FROM sessions
WHERE is_recurring_template = true
ORDER BY name;
```

### Count Generated Sessions per Template

```sql
-- Count how many sessions generated per template
SELECT
  m.id,
  m.name as template_name,
  COUNT(s.id) as sessions_generated,
  MIN(s.scheduled_date) as earliest_session,
  MAX(s.scheduled_date) as latest_session
FROM sessions m
LEFT JOIN sessions s ON s.parent_session_id = m.id
WHERE m.is_recurring_template = true
GROUP BY m.id, m.name
ORDER BY m.name;
```

---

## Notes

- **Timezone**: All timestamps are in UTC. Adjust your cron schedule accordingly.
- **Performance**: The functions are optimized to handle large datasets efficiently.
- **Idempotency**: Running the generation function multiple times won't create duplicates (it checks for existing sessions).
- **Cleanup**: Consider adding a cleanup job to archive very old closed sessions (e.g., older than 90 days).

---

## Next Steps

1. Choose your preferred cron method (pg_cron recommended when available)
2. Set up the scheduled jobs
3. Test with a recurring template
4. Monitor the logs for the first few days
5. Adjust timing if needed based on your usage patterns
