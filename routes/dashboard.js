const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabaseAdmin } = require('../config/supabase')

const dashboardStyles = `
<style>
  .dashboard-grid {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 22px;
  }

  .stat-card {
    padding: 24px;
    min-height: 158px;
  }

  .stat-icon {
    width: 48px;
    height: 48px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    margin-bottom: 16px;
  }

  .stat-income { background: rgba(16,185,129,0.12); }
  .stat-expense { background: rgba(239,68,68,0.12); }
  .stat-balance { background: rgba(99,102,241,0.12); }
  .stat-employees { background: rgba(139,92,246,0.12); }

  .stat-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-4);
    margin-bottom: 8px;
  }

  .stat-value {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 30px;
    font-weight: 800;
    line-height: 1.1;
  }

  .stat-sub {
    margin-top: 10px;
    font-size: 13px;
    color: var(--text-3);
  }

  .transaction-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 18px 18px;
  }

  .transaction-item {
    display: grid;
    grid-template-columns: 96px minmax(1fr, 1.4fr) 118px 120px;
    gap: 12px;
    align-items: center;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border-2);
  }

  .transaction-date {
    font-size: 13px;
    color: var(--text-4);
  }

  .transaction-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .transaction-desc {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }

  .transaction-category {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-4);
    font-size: 12px;
    font-weight: 600;
  }

  .transaction-status {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .transaction-amount {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 16px;
    font-weight: 800;
    text-align: right;
  }

  .transaction-amount.text-income { color: #10b981; }
  .transaction-amount.text-expense { color: #ef4444; }

  .quick-actions {
    display: grid;
    gap: 12px;
    padding: 0 18px 18px;
  }

  .quick-actions a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: var(--text-2);
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-weight: 600;
    transition: transform 0.2s, border-color 0.2s, background 0.2s;
  }

  .quick-actions a.primary {
    background: var(--primary-dim);
    color: var(--primary);
    border-color: var(--primary-border);
  }

  .quick-actions a:hover {
    transform: translateY(-1px);
  }

  .order-card {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    padding: 16px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border-2);
  }

  .order-card + .order-card {
    margin-top: 12px;
  }

  .order-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .order-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }

  .order-subtitle {
    font-size: 12px;
    color: var(--text-4);
  }

  .side-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  @media (max-width: 980px) {
    .dashboard-grid { grid-template-columns: 1fr; }
    .stats-4 { grid-template-columns: repeat(2, 1fr); }
    .transaction-item { grid-template-columns: 96px minmax(1fr, 1fr) 110px; }
  }

  @media (max-width: 680px) {
    .stats-4 { grid-template-columns: 1fr; }
    .dashboard-grid { gap: 18px; }
    .page-header { flex-direction: column; align-items: flex-start; gap: 16px; }
    .transaction-item { grid-template-columns: 1fr; }
    .transaction-amount { text-align: left; margin-top: 10px; }
  }
</style>
`

router.get('/', requireAuth, async (req, res) => {
  try {
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

    const [
      { data: transactions },
      { data: recentTx },
      { data: recentOrders },
      { data: employees }
    ] = await Promise.all([
      supabaseAdmin.from('transactions').select('type, amount')
        .gte('transaction_date', firstDay).lte('transaction_date', lastDay),
      supabaseAdmin.from('transactions')
        .select('type, amount, description, transaction_date, category:transaction_categories(name)')
        .order('transaction_date', { ascending: false }).limit(5),
      supabaseAdmin.from('sale_orders')
        .select('doc_no, doc_type, doc_date, total, payment_status, customer_name')
        .order('doc_date', { ascending: false }).limit(5),
      supabaseAdmin.from('employees').select('id').eq('status', 'active')
    ])

    let totalIncome = 0, totalExpense = 0
    ;(transactions || []).forEach(t => {
      if (t.type === 'income') totalIncome += parseFloat(t.amount) || 0
      else totalExpense += parseFloat(t.amount) || 0
    })

    res.render('dashboard', {
      title: 'Dashboard', activePage: 'dashboard',
      extraStyles: dashboardStyles,
      stats: {
        totalIncome, totalExpense,
        balance: totalIncome - totalExpense,
        totalEmployees: (employees || []).length
      },
      recentTransactions: recentTx || [],
      recentOrders: recentOrders || []
    })
  } catch (err) {
    console.error(err)
    res.render('dashboard', {
      title: 'Dashboard', activePage: 'dashboard',
      extraStyles: dashboardStyles,
      stats: { totalIncome: 0, totalExpense: 0, balance: 0, totalEmployees: 0 },
      recentTransactions: [], recentOrders: []
    })
  }
})

module.exports = router
