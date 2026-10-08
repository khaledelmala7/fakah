const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initial In-Memory Ledger according to Approved Plan
const initialState = () => ({
  platform: {
    name: 'منظومة فَكَّة للمدفوعات اليومية (Fakah)',
    slogan: 'ادفع عند كَاسِب.. وخليك دايماً فَاكِك!',
    floatAnnualRate: 0.22, // 22% average yield on Treasury Bills in partner bank
    totalCashOutFeesCollected: 0.0,
    totalTransactionsCount: 0,
    totalVolumeTransacted: 0.0,
    maxTxnLimit: 100.0,
    minTxnLimit: 0.25
  },
  users: [
    {
      id: 'fakik_1',
      role: 'fakik',
      name: 'محمد علي (فَاكِك)',
      title: 'زبون وراكب يومي',
      phone: '01012345678',
      balance: 85.50,
      avatar: '🧑‍💻'
    },
    {
      id: 'fakik_2',
      role: 'fakik',
      name: 'سارة خالد (فَاكِك)',
      title: 'طالبة جامعية',
      phone: '01198765432',
      balance: 50.00,
      avatar: '👩‍🎓'
    },
    {
      id: 'kasib_1',
      role: 'kasib',
      name: 'الأسطى أحمد (كَاسِب)',
      title: 'سائق ميكروباص (ط س ج ٤٩٢١)',
      route: 'خط جامعة القاهرة - الجيزة',
      phone: '01234567890',
      balance: 215.00,
      avatar: '🚐',
      soundEnabled: true
    },
    {
      id: 'kasib_2',
      role: 'kasib',
      name: 'عم حسن (كَاسِب)',
      title: 'صاحب كشك وبقالة النصر',
      storeName: 'كشك النصر للحلويات والسجائر',
      phone: '01511223344',
      balance: 140.00,
      avatar: '🏪',
      soundEnabled: true
    },
    {
      id: 'kasib_3',
      role: 'kasib',
      name: 'المعلم إبراهيم (كَاسِب)',
      title: 'بائع خضار وفاكهة',
      storeName: 'خضار أولاد إبراهيم (كسور الميزان)',
      phone: '01099887766',
      balance: 310.25,
      avatar: '🥬',
      soundEnabled: true
    }
  ],
  transactions: [
    {
      id: 'TXN-101',
      fromId: 'fakik_1',
      fromName: 'محمد علي (فَاكِك)',
      toId: 'kasib_1',
      toName: 'الأسطى أحمد (كَاسِب)',
      amount: 7.50,
      amountWords: 'سبعة جنيهات ونصف',
      type: 'PAYMENT',
      note: 'أجرة ميكروباص خط الجامعة',
      status: 'COMPLETED',
      timestamp: '١٠:١٥ م',
      verificationHash: 'v_9a8f12'
    },
    {
      id: 'TXN-100',
      fromId: 'kasib_2',
      fromName: 'عم حسن (كَاسِب)',
      toId: 'fakik_2',
      toName: 'سارة خالد (فَاكِك)',
      amount: 14.50,
      amountWords: 'أربعة عشر جنيهاً ونصف',
      type: 'REVERSE_CHANGE',
      note: 'رد باقي نقدي (بديل اللبانة)',
      status: 'COMPLETED',
      timestamp: '٠٩:٤٥ م',
      verificationHash: 'v_7b2c44'
    }
  ]
});

let db = initialState();

// Broadcast WebSocket message to all connected clients
function broadcast(eventType, payload) {
  const msg = JSON.stringify({ type: eventType, data: payload, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Convert numbers into Arabic spoken words
function amountToArabicWords(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return `${num} جنيه`;
  
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100);

  let text = '';
  if (whole === 1) text = 'جنيه واحد';
  else if (whole === 2) text = 'جنيهان';
  else if (whole >= 3 && whole <= 10) text = `${whole} جنيهات`;
  else if (whole > 10) text = `${whole} جنيهاً`;

  if (frac === 50) {
    text = (whole === 0) ? 'نصف جنيه' : `${text} ونصف`;
  } else if (frac === 25) {
    text = (whole === 0) ? 'ربع جنيه' : `${text} وربع`;
  } else if (frac === 75) {
    text = (whole === 0) ? 'خمسة وسبعون قرشاً' : `${text} إلا ربع`;
  } else if (frac > 0) {
    text = (whole === 0) ? `${frac} قرشاً` : `${text} و${frac} قرشاً`;
  }

  return text || `${num} جنيه`;
}

// API: Current state
app.get('/api/state', (req, res) => {
  const totalBalances = db.users.reduce((acc, u) => acc + u.balance, 0);
  const estimatedAnnualFloat = totalBalances * db.platform.floatAnnualRate;

  res.json({
    users: db.users,
    transactions: db.transactions,
    platform: {
      ...db.platform,
      totalBalancesHeld: parseFloat(totalBalances.toFixed(2)),
      estimatedAnnualFloatEarnings: parseFloat(estimatedAnnualFloat.toFixed(2))
    }
  });
});

// API 1: فِكّ (Payment from فَاكِك to كَاسِب)
app.post('/api/pay', (req, res) => {
  const { fromId, toId, amount, note } = req.body;
  const payAmount = parseFloat(amount);

  if (isNaN(payAmount) || payAmount < db.platform.minTxnLimit) {
    return res.status(400).json({ error: `الحد الأدنى للمعاملة هو ${db.platform.minTxnLimit} جنيه (ربع جنيه)` });
  }

  if (payAmount > db.platform.maxTxnLimit) {
    return res.status(400).json({ error: `الحد الأقصى للمعاملة الواحدة هو ${db.platform.maxTxnLimit} جنيه مصري للحفاظ على طابع الفكة المصغرة` });
  }

  const sender = db.users.find(u => u.id === fromId);
  const receiver = db.users.find(u => u.id === toId);

  if (!sender || !receiver) {
    return res.status(404).json({ error: 'المستخدم غير موجود' });
  }

  if (sender.balance < payAmount) {
    return res.status(400).json({ error: 'الرصيد غير كافٍ في محفظة فَاكِك، يرجى الشحن' });
  }

  // Execute double-entry ledger movement
  sender.balance = parseFloat((sender.balance - payAmount).toFixed(2));
  receiver.balance = parseFloat((receiver.balance + payAmount).toFixed(2));

  const txnId = `TXN-${Math.floor(1000 + Math.random() * 9000)}`;
  const txn = {
    id: txnId,
    fromId: sender.id,
    fromName: sender.name,
    toId: receiver.id,
    toName: receiver.name,
    amount: payAmount,
    amountWords: amountToArabicWords(payAmount),
    type: 'PAYMENT',
    note: note || 'دفع فوري عند كَاسِب',
    status: 'COMPLETED',
    timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    verificationHash: 'v_' + Math.random().toString(36).substring(2, 8)
  };

  db.transactions.unshift(txn);
  db.platform.totalTransactionsCount += 1;
  db.platform.totalVolumeTransacted = parseFloat((db.platform.totalVolumeTransacted + payAmount).toFixed(2));

  broadcast('NEW_PAYMENT', {
    transaction: txn,
    sender: { id: sender.id, balance: sender.balance },
    receiver: { id: receiver.id, balance: receiver.balance }
  });

  res.json({ success: true, transaction: txn });
});

// API 2: رُدّ (Reverse Change from كَاسِب to فَاكِك)
app.post('/api/reverse-change', (req, res) => {
  const { merchantId, customerId, changeAmount, cashNote } = req.body;
  const amount = parseFloat(changeAmount);

  if (isNaN(amount) || amount < db.platform.minTxnLimit) {
    return res.status(400).json({ error: 'مبلغ الباقي غير صالح' });
  }

  if (amount > db.platform.maxTxnLimit) {
    return res.status(400).json({ error: 'الحد الأقصى لرد الباقي هو 100 جنيه' });
  }

  const merchant = db.users.find(u => u.id === merchantId);
  const customer = db.users.find(u => u.id === customerId);

  if (!merchant || !customer) {
    return res.status(404).json({ error: 'الطرفان غير موجودين' });
  }

  if (merchant.balance < amount) {
    return res.status(400).json({ error: 'رصيد كَاسِب في التطبيق غير كافٍ لرد هذا الباقي' });
  }

  // Movement: Merchant -> Customer
  merchant.balance = parseFloat((merchant.balance - amount).toFixed(2));
  customer.balance = parseFloat((customer.balance + amount).toFixed(2));

  const txnId = `CHG-${Math.floor(1000 + Math.random() * 9000)}`;
  const txn = {
    id: txnId,
    fromId: merchant.id,
    fromName: merchant.name,
    toId: customer.id,
    toName: customer.name,
    amount: amount,
    amountWords: amountToArabicWords(amount),
    type: 'REVERSE_CHANGE',
    note: cashNote || 'رد باقي نقدي فوري (إنقاذ البيعة)',
    status: 'COMPLETED',
    timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    verificationHash: 'v_chg_' + Math.random().toString(36).substring(2, 8)
  };

  db.transactions.unshift(txn);
  db.platform.totalTransactionsCount += 1;
  db.platform.totalVolumeTransacted = parseFloat((db.platform.totalVolumeTransacted + amount).toFixed(2));

  broadcast('NEW_REVERSE_CHANGE', {
    transaction: txn,
    merchant: { id: merchant.id, balance: merchant.balance },
    customer: { id: customer.id, balance: customer.balance }
  });

  res.json({ success: true, transaction: txn });
});

// API 3: اشحن (Top-Up for فَاكِك)
app.post('/api/topup', (req, res) => {
  const { userId, amount } = req.body;
  const topAmount = parseFloat(amount);

  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

  user.balance = parseFloat((user.balance + topAmount).toFixed(2));

  const txn = {
    id: `TOP-${Math.floor(1000 + Math.random() * 9000)}`,
    fromId: 'ESCROW_BANK',
    fromName: 'شحن محفظة (إنستاباي / ميزة)',
    toId: user.id,
    toName: user.name,
    amount: topAmount,
    amountWords: amountToArabicWords(topAmount),
    type: 'TOPUP',
    note: 'إيداع رصيد فكة',
    status: 'COMPLETED',
    timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
    verificationHash: 'v_top_' + Math.random().toString(36).substring(2, 8)
  };

  db.transactions.unshift(txn);
  broadcast('BALANCE_UPDATED', { user, transaction: txn });
  res.json({ success: true, user, transaction: txn });
});

// API 4: اقبض (Cash-Out for كَاسِب)
app.post('/api/cashout', (req, res) => {
  const { userId, amount, destination } = req.body;
  const withdrawAmount = parseFloat(amount);

  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

  if (user.balance < withdrawAmount) {
    return res.status(400).json({ error: 'رصيد كَاسِب غير كافٍ للسحب' });
  }

  const fee = parseFloat((withdrawAmount * 0.015).toFixed(2)); // 1.5% Cash-Out Fee
  const netAmount = parseFloat((withdrawAmount - fee).toFixed(2));

  user.balance = parseFloat((user.balance - withdrawAmount).toFixed(2));
  db.platform.totalCashOutFeesCollected = parseFloat((db.platform.totalCashOutFeesCollected + fee).toFixed(2));

  const txn = {
    id: `WTH-${Math.floor(1000 + Math.random() * 9000)}`,
    fromId: user.id,
    fromName: user.name,
    toId: destination || 'فودافون كاش',
    toName: `سحب نقدي كاش (${destination || 'محفظة هاتف'})`,
    amount: withdrawAmount,
    fee: fee,
    netAmount: netAmount,
    type: 'CASHOUT',
    note: `صافي مستلم: ${netAmount} ج.م بعد عمولة ${fee} ج.م`,
    status: 'COMPLETED',
    timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
    verificationHash: 'v_wth_' + Math.random().toString(36).substring(2, 8)
  };

  db.transactions.unshift(txn);
  broadcast('CASHOUT_PROCESSED', { user, fee, netAmount, transaction: txn });
  res.json({ success: true, user, fee, netAmount, transaction: txn });
});

// API: Reset to fresh initial state
app.post('/api/reset', (req, res) => {
  db = initialState();
  broadcast('SYSTEM_RESET', {});
  res.json({ success: true });
});

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`=================================================`);
  console.log(`🚀 منظومة فَكَّة المحدثة (Fakah Platform) تعمل الآن:`);
  console.log(`💻 من الكمبيوتر:      http://localhost:${PORT}`);
  console.log(`📱 من الهاتف (واي فاي): http://${localIp}:${PORT}`);
  console.log(`=================================================`);
});
