const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const { check, validationResult } = require('express-validator');

const staffloginController = {
    getStaffLogin: function(req, res) {
    // Fetch errors from flash messages
    const errors = {
        loginError: req.flash('loginError')[0] || null
    };
    console.log('Retrieved flash errors:', errors);
    // Render the view and pass errors
    res.render('staffpages/stafflogin', { errors });
},

   postStaffLogin: async (req, res) => {
    // Validation
    await check('email').isEmail().withMessage('Invalid email').run(req);
    await check('password').notEmpty().withMessage('Password is required').run(req);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.flash('errors', { loginError: errors.array().map(error => error.msg).join(', ') });
        return res.redirect('/staff/login');
    }
    
    const { email, password, rememberMe } = req.body;
    
    // Fetch user from Supabase
    const { data: user, error } = await supabase
        .from('useraccounts')
        .select('*')
        .eq('userEmail', email)
        .single();
    
    // Check for errors or if user does not exist
    if (error || !user) {
        req.flash('errors', { loginError: 'Invalid email or password' });
        return res.redirect('/staff/login');
    }
    
   // Check if user account is disabled
if (user.userIsDisabled) {
    req.flash('loginError', 'Account is disabled. Please contact administrator.');
    console.log('Flash message set for disabled account');
    return res.redirect('/staff/login');
}


    
    // Compare the provided password with the hashed password in the database
    const isMatch = await bcrypt.compare(password, user.userPass);
    if (!isMatch) {
        req.flash('errors', { loginError: 'Invalid email or password' });
        return res.redirect('/staff/login');
    }
    
    // Store user information in the session
    req.session.user = {
        userId: user.userId,
        userEmail: user.userEmail,
        userRole: user.userRole,
    };
    
    // Set a persistent cookie if "Remember Me" is checked
    if (rememberMe) {
        res.cookie('connect.sid', req.sessionID, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true }); // 30 days
    }
    
    // Redirect based on user role
    switch (user.userRole) {
        case 'HR':
            return res.redirect('/hr/dashboard');
        case 'Employee':
            return res.redirect('/employee/useracc');
        case 'Line Manager':
            return res.redirect('/linemanager/dashboard');
        default:
            req.flash('errors', { loginError: 'Unauthorized access' });
            return res.redirect('/staff/login');
    }
}
    // postStaffLogin: async function(req, res) {
    //     // Validation
    //     await check('email').isEmail().withMessage('Invalid email').run(req);
    //     await check('password').notEmpty().withMessage('Password is required').run(req);

    //     const errors = validationResult(req);
    //     if (!errors.isEmpty()) {
    //         req.flash('errors', { loginError: errors.array().map(error => error.msg).join(', ') });
    //         return res.redirect('/staff/login');
    //     }

    //     const { email, password } = req.body;

    //     // Fetch user from Supabase
    //     const { data: user, error } = await supabase
    //         .from('useraccounts')
    //         .select('*')
    //         .eq('userEmail', email)
    //         .single();

    //     // Check for errors or if user does not exist
    //     if (error || !user) {
    //         req.flash('errors', { loginError: 'Invalid email or password' });
    //         return res.redirect('/staff/login');
    //     }

    //     // Compare the provided password with the hashed password in the database
    //     const isMatch = await bcrypt.compare(password, user.userPass);
    //     if (!isMatch) {
    //         req.flash('errors', { loginError: 'Invalid email or password' });
    //         return res.redirect('/staff/login');
    //     }

    //     // Store user information in the session
    //     req.session.user = user;

    //     // Redirect based on user role
    //     switch (user.userRole) {
    //         case 'HR':
    //             res.redirect('/hr/dashboard');
    //             break;
    //         case 'Employee':
    //             res.redirect('/employee/useracc');
    //             break;
    //         case 'Line Manager':
    //             res.redirect('/linemanager/dashboard');
    //             break;
    //         default:
    //             req.flash('errors', { loginError: 'Unauthorized access' });
    //             res.redirect('/staff/login');
    //     }
    // },
};

// Export the staffloginController object
module.exports = staffloginController;
