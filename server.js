const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');
const cors = require('cors');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// --- MySQL Connection Pool (MOVED TO TOP) ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test DB Connection - SERVER ONLY STARTS AFTER SUCCESSFUL DB CONNECTION
pool.getConnection()
    .then(connection => {
        console.log('Connected to MySQL database!');
        connection.release(); // Release the connection immediately after testing

        // --- Middleware (Defined after app and dependencies, but before routes) ---
        app.use(express.json());
        app.use(cors());

        // --- API Endpoints ---
        // (All your app.post and app.get routes go here, just as you had them)

        // 1. User Registration (Signup)
        app.post('/api/register', async (req, res) => {
            const { email, password, name } = req.body;

            if (!email || !password || !name) {
                return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، وكلمة المرور مطلوبان.' });
            }

            try {
                const hashedPassword = await bcrypt.hash(password, 10);

                const [result] = await pool.execute( // 'pool' is now defined
                    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
                    [name, email, hashedPassword]
                );
                res.status(201).json({ message: 'تم إنشاء الحساب بنجاح!', userId: result.insertId });

            } catch (error) {
                if (error.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ message: 'هذا البريد الإلكتروني مسجل بالفعل.' });
                }
                console.error('Signup error:', error);
                res.status(500).json({ message: 'حدث خطأ في الخادم عند إنشاء الحساب.' });
            }
        });

        // 2. User Login
        app.post('/api/login', async (req, res) => {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان.' });
            }

            try {
                const [rows] = await pool.execute( // 'pool' is now defined
                    'SELECT id, name, email, password FROM users WHERE email = ?',
                    [email]
                );

                const user = rows[0];

                if (!user) {
                    return res.status(401).json({ message: 'بيانات الاعتماد غير صحيحة.' });
                }

                const isMatch = await bcrypt.compare(password, user.password);

                if (!isMatch) {
                    return res.status(401).json({ message: 'بيانات الاعتماد غير صحيحة.' });
                }

                res.status(200).json({
                    message: 'تم تسجيل الدخول بنجاح!',
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email
                    }
                });

            } catch (error) {
                console.error('Login error:', error);
                res.status(500).json({ message: 'حدث خطأ في الخادم عند تسجيل الدخول.' });
            }
        });

        // 3. Add a package to a user's account
        app.post('/api/user/packages', async (req, res) => {
            const { userId, packageName, sessionsTotal, durationDays } = req.body;

            if (!userId || !packageName || !sessionsTotal) {
                return res.status(400).json({ message: 'معرف المستخدم، اسم الباقة، وعدد الحصص الكلي مطلوب.' });
            }

            let expiryDate = null;
            const bookedDate = new Date();
            if (durationDays) {
                expiryDate = new Date(bookedDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
            }
            
            const sessionsUsed = 0;
            const status = 'active';

            try {
                const [result] = await pool.execute( // 'pool' is now defined
                    `INSERT INTO user_packages 
                    (user_id, package_name, sessions_total, sessions_used, duration_days, booked_date, expiry_date, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, packageName, sessionsTotal, sessionsUsed, durationDays, bookedDate, expiryDate, status]
                );

                res.status(201).json({ message: 'تم إضافة الباقة بنجاح!', packageId: result.insertId });

            } catch (error) {
                console.error('Error adding package for user:', error);
                res.status(500).json({ message: 'حدث خطأ في الخادم عند إضافة الباقة.' });
            }
        });

        // 4. Get User Profile Data and Packages
        app.get('/api/profile/:userId', async (req, res) => {
            const userId = req.params.userId;

            try {
                const [users] = await pool.execute( // 'pool' is now defined
                    'SELECT id, name, email FROM users WHERE id = ?',
                    [userId]
                );
                const user = users[0];

                if (!user) {
                    return res.status(404).json({ message: 'المستخدم غير موجود.' });
                }

                const [packages] = await pool.execute( // 'pool' is now defined
                    `SELECT 
                        package_name, 
                        sessions_total, 
                        sessions_used, 
                        duration_days, 
                        DATE_FORMAT(booked_date, '%Y-%m-%d') as booked_date, 
                        DATE_FORMAT(expiry_date, '%Y-%m-%d') as expiry_date, 
                        status
                    FROM user_packages 
                    WHERE user_id = ?
                    ORDER BY booked_date DESC`, 
                    [userId]
                );

                res.status(200).json({
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email
                    },
                    packages: packages 
                });

            } catch (error) {
                console.error('Failed to get user profile and packages:', error);
                res.status(500).json({ message: 'حدث خطأ في الخادم عند جلب بيانات الملف الشخصي والباقات.' });
            }
        });

        // --- Static File Serving (THIS REMAINS LAST) ---
        app.use(express.static(path.join(__dirname, 'public')));

        // --- Error Handling Middleware ---
        // 404 Catch-all for unmatched routes
        app.use((req, res) => {
            // Check if it's an API route that didn't match
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(404).json({ message: 'API endpoint not found.' });
            }
            // Otherwise, serve 404.html for web pages
            res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
        });

        // General Error Handler
        app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).json({ message: 'Someth_ing broke! Internal Server Error.' });
        });

        // Start the server (inside the .then() block of the DB connection check)
        app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}`);
            console.log('Serving static files from /public');
        });

    })
    .catch(err => {
        console.error('Failed to connect to MySQL:', err);
        process.exit(1); // Exit process if DB connection fails
    });
