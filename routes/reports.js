const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { supabase } = require('../config/supabase')

router.get('/', requireAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear()
    const startDate = `${year}-01-01`
    const endDate = `${year}-12-31`

    const [{ data: transactions }, { data: employees }] = await Promise.all([
      supabase.from('transactions')
        .select('type, amount, transaction_date, category:transaction_categories(name, type)')
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .order('transaction_date'),
      supabase.from('employees').select('id').eq('status', 'active')
    ])

    // คำนวณรายเดือน
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthName: new Date(year, i, 1).toLocaleDateString('th-TH', { month: 'short' }),
      income: 0,
      expense: 0
    }))

    let totalIncome = 0, totalExpense = 0
    const categoryMap = {}

    ;(transactions || []).forEach(t => {
      const month = new Date(t.transaction_date).getMonth()
      const amt = parseFloat(t.amount) || 0
      if (t.type === 'income') {
        monthlyData[month].income += amt
        totalIncome += amt
      } else {
        monthlyData[month].expense += amt
        totalExpense += amt
      }
      const catName = t.category?.name || 'อื่นๆ'
      if (!categoryMap[catName]) categoryMap[catName] = { name: catName, type: t.type, total: 0 }
      categoryMap[catName].total += amt
    })

    const categoryBreakdown = Object.values(categoryMap).sort((a, b) => b.total - a.total).slice(0, 10)
    const availableYears = []
    for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 4; y--) availableYears.push(y)

    res.render('reports/index', {
      title: 'รายงานการเงิน', activePage: 'reports',
      year, availableYears,
      monthlyData,
      totalIncome, totalExpense,
      netProfit: totalIncome - totalExpense,
      categoryBreakdown,
      totalEmployees: (employees || []).length
    })
  } catch (err) {
    console.error('Reports error:', err)
    res.render('reports/index', {
      title: 'รายงานการเงิน', activePage: 'reports',
      year: new Date().getFullYear(), availableYears: [new Date().getFullYear()],
      monthlyData: [], totalIncome: 0, totalExpense: 0, netProfit: 0,
      categoryBreakdown: [], totalEmployees: 0
    })
  }
})

module.exports = router
