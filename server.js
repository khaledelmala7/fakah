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

// Initial In-Memory Database with PIN support
const initialState = () => ({
  platform: {
    name: 'منظومة فَكَّة للمدفوعات اليومية (Fakah)',
    slogan: 'ادفع عند كَاسِب.. وخليك دايماً فَاكِك!',
    floatAnnualRate: 0.22,
    totalCashOutFeesCollected: 0.0,
    totalTransactionsCount: 0,
    totalVolumeTransacted: 0.0,
    maxTxnLimit: 100.0,
    minTxnLimit: 0.25
  },
  users: [
    {
      id: 'kasib_demo_1',
      role: 'kasib',
      name: 'الأسطى أحمد (كَاسِب)',
      title: 'سائق ميكروباص (ط س ج ٤٩٢١)',
      phone: '01234567890',
      pin: '1234',
      balance: 215.00,
      avatar: '🚐',
      soundEnabled: true
    },
    {
      id: 'kasib_demo_2',
      role: 'kasib',
      name: 'عم حسن (كَاسِب)',
      title: 'كشك وبقالة النصر',
      phone: '01511223344',
      pin: '1234',
      balance: 140.00,
      avatar: '🏪',
      soundEnabled: true
    }
  ],
  transactions: [
    {
      id: 'TXN-101',
      fromId: 'system',
      fromName: 'نظام فكة',
      toId: 'kasib_demo_1',
      toName: 'الأسطى أحمد (كَاسِب)',
      amount: 7.50,
      amountWords: 'سبعة جنيهات ونصف',
      type: 'PAYMENT',
      note: 'أجرة ترحيبية',
      status: 'COMPLETED',
      timestamp: '١٠:١٥ م',
      verificationHash: 'v_init_1'
    }
  ]
});

let db = initialState();

function broadcast(eventType, payload) {
  const msg = JSON.stringify({ type: eventType, data: payload, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

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

// API: State
app.get('/api/state', (req, res) => {
  const totalBalances = db.users.reduce((acc, u) => acc + u.balance, 0);
  const estimatedAnnualFloat = totalBalances * db.platform.floatAnnualRate;

  // Mask PINs for security
  const safeUsers = db.users.map(({ pin, ...userRest }) => userRest);

  res.json({
    users: safeUsers,
    transactions: db.transactions,
    platform: {
      ...db.platform,
      totalBalancesHeld: parseFloat(totalBalances.toFixed(2)),
      estimatedAnnualFloatEarnings: parseFloat(estimatedAnnualFloat.toFixed(2))
    }
  });
});

// API: 1. تسجيل الدخول برقم الموبايل + الرمز السري (PIN)
app.post('/api/auth/login', (req, res) => {
  const { phone, pin } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'يرجى كتابة رقم الموبايل' });
  }

  if (!pin || pin.length !== 4) {
    return res.status(400).json({ error: 'يرجى إدخال الرمز السري المكون من 4 أرقام' });
  }

  const cleanPhone = phone.trim().replace(/\s+/g, '');
  const user = db.users.find(u => u.phone === cleanPhone);

  if (!user) {
    return res.status(404).json({ 
      error: 'رقم الموبايل هذا غير مسجل. اضغط على تبويب "إنشاء حساب جديد" للتسجيل.' 
    });
  }

  // Verify PIN
  if (user.pin && user.pin !== pin.trim()) {
    return res.status(401).json({ error: 'الرمز السري (PIN) غير صحيح، يرجى المحاولة مرة أخرى' });
  }

  const { pin: userPin, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// API: 2. إنشاء حساب جديد مع تعيين الرمز السري (PIN)
app.post('/api/auth/register', (req, res) => {
  const { name, phone, pin, role, details } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'يرجى كتابة الاسم ورقم الموبايل' });
  }

  if (!pin || pin.length !== 4 || isNaN(pin)) {
    return res.status(400).json({ error: 'يجب تعيين رمز سري (PIN) مكون من 4 أرقام' });
  }

  const cleanPhone = phone.trim().replace(/\s+/g, '');
  const existing = db.users.find(u => u.phone === cleanPhone);

  if (existing) {
    return res.status(400).json({ 
      error: 'رقم الموبايل هذا مسجل بالفعل مسبقاً! يرجى الانتقال إلى تبويب "تسجيل الدخول" وكتابة الرمز السري.' 
    });
  }

  const userRole = role === 'kasib' ? 'kasib' : 'fakik';
  const avatar = userRole === 'kasib' ? (details && details.includes('ميكروباص') ? '🚐' : '🏪') : '🧑‍💻';

  const user = {
    id: `usr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    role: userRole,
    name: name.trim(),
    title: details || (userRole === 'kasib' ? 'بائع / سائق معتمد' : 'زبون وراكب فَاكِك'),
    phone: cleanPhone,
    pin: pin.trim(),
    balance: 100.00, // 100 EGP Welcome balance
    avatar: avatar,
    soundEnabled: true
  };

  db.users.push(user);
  
  const { pin: userPin, ...safeUser } = user;
  broadcast('USER_REGISTERED', { user: safeUser });

  res.json({ success: true, user: safeUser });
});

// API: Payment (فَاكِك -> كَاسِب)
app.post('/api/pay', (req, res) => {
  const { fromId, toId, amount, note } = req.body;
  const payAmount = parseFloat(amount);

  if (isNaN(payAmount) || payAmount < db.platform.minTxnLimit) {
    return res.status(400).json({ error: `الحد الأدنى للمعاملة هو ${db.platform.minTxnLimit} جنيه` });
  }

  if (payAmount > db.platform.maxTxnLimit) {
    return res.status(400).json({ error: `الحد الأقصى للمعاملة هو ${db.platform.maxTxnLimit} جنيه` });
  }

  const sender = db.users.find(u => u.id === fromId);
  const receiver = db.users.find(u => u.id === toId);

  if (!sender || !receiver) {
    return res.status(404).json({ error: 'المستخدم غير موجود' });
  }

  if (sender.balance < payAmount) {
    return res.status(400).json({ error: 'رصيد محفظتك غير كافٍ، اضغط على زر "اشحن فكة"' });
  }

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

// API: Reverse Change (كَاسِب -> فَاكِك)
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
    return res.status(400).json({ error: 'رصيد كَاسِب في المحفظة غير كافٍ لرد هذا الباقي' });
  }

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

// API: Top-Up
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

// API: Cash-Out
app.post('/api/cashout', (req, res) => {
  const { userId, amount, destination } = req.body;
  const withdrawAmount = parseFloat(amount);

  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

  if (user.balance < withdrawAmount) {
    return res.status(400).json({ error: 'رصيد كَاسِب غير كافٍ للسحب' });
  }

  const fee = parseFloat((withdrawAmount * 0.015).toFixed(2));
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

// API: Reset
app.post('/api/reset', (req, res) => {
  db = initialState();
  broadcast('SYSTEM_RESET', {});
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 منظومة فَكَّة تعمل على منفذ: ${PORT}`);
});
