const employeeController = {
    getEmployeeDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Employee') {
            res.render('staffpages/employee_pages/employeedashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
            res.redirect('/staff/login');
        }
    },

    // Method to render the user account page
    getUserAccountPage: function(req, res) {
        try {
            if (req.session.user && req.session.user.userRole === 'Employee') {
                // Render the user account page
                res.render('staffpages/employee_pages/useracc');
            } else {
                req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
                res.redirect('/staff/login');
            }
        } catch (error) {
            console.error("Error rendering user account page:", error);
            req.flash('errors', { systemError: 'An unexpected error occurred. Please try again later.' });
            res.redirect('/staff/login');
        }
    }

};

module.exports = employeeController;
