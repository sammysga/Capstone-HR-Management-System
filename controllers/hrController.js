const hrController = {
    getHRDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('/staffpages/hr_pages/hrdashboard.ejs');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/login/staff');
        }
    },
};

module.exports = hrController;
