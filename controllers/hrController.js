const hrController = {
    getHRDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            // Render using the relative path from the views directory
            res.render('staffpages/hr_pages/hrdashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    },
};

module.exports = hrController;
