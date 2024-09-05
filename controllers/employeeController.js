const employeeController = {
    getEmployeeDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Employee') {
            res.render('employee/dashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
            res.redirect('/login/staff');
        }
    },
};

module.exports = employeeController;
