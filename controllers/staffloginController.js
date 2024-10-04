const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const { check, validationResult } = require('express-validator');

const staffloginController = {
    getStaffLogin: function(req, res) {
        // Fetch errors from flash messages
        const errors = req.flash('errors') || {};
        // Render the view and pass errors
        res.render('staffpages/stafflogin', { errors });
    },
    postStaffLogin: async function(req, res) {
        // Validation
        await check('email').isEmail().withMessage('Invalid email').run(req);
        await check('password').notEmpty().withMessage('Password is required').run(req);

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.flash('errors', { loginError: errors.array().map(error => error.msg).join(', ') });
            return res.redirect('/staff/login');
        }

        const { email, password } = req.body;

        const { data: user, error } = await supabase
            .from('useraccounts')
            .select('*')
            .eq('userEmail', email)
            .single();

        if (error || !user) {
            req.flash('errors', { loginError: 'Invalid email or password' });
            return res.redirect('/staff/login');
        }

        const isMatch = await bcrypt.compare(password, user.userPass);
        if (!isMatch) {
            req.flash('errors', { loginError: 'Invalid email or password' });
            return res.redirect('/staff/login');
        }

        req.session.user = user;

        // Redirect based on user role
        switch (user.userRole) {
            case 'HR':
                res.redirect('/hr/dashboard');
                break;
            case 'Employee':
                res.redirect('/employee/dashboard');
                break;
            case 'Line Manager':
                res.redirect('/linemanager/dashboard');
                break;
            default:
                req.flash('errors', { loginError: 'Unauthorized access' });
                res.redirect('/staff/login');
        }
    },
};

// Export the staffloginController object
module.exports = staffloginController;
