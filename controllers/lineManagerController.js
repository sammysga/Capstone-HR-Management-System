const lineManagerController = {
    getLineManagerDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/managerdashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/login/staff');
        }
    },
};

module.exports = lineManagerController;
