const employeeController = {
    getEmployeeDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Employee') {
            res.render('staffpages/employee_pages/employeedashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
            res.redirect('/staff/login');
        }
    },

    getUserAccount: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'Employee') {
            try {
                // Fetch the user's details from Supabase using the userId from the session
                const { data, error } = await supabase
                    .from('users')
                    .select('userEmail, userRole')
                    .eq('userId', req.session.user.userId)
                    .single();

                if (error) {
                    console.error('Error fetching user details:', error);
                    req.flash('errors', { fetchError: 'Unable to fetch user details.' });
                    res.redirect('/staff/login');
                } else {
                    // Pass the fetched user data to the EJS template
                    res.render('staffpages/employee_pages/useracc', {
                        user: {
                            email: data.userEmail,
                            userRole: data.userRole,
                        }
                    });
                }
            } catch (err) {
                console.error('Error in getUserAccount controller:', err);
                req.flash('errors', { fetchError: 'Error occurred while fetching data.' });
                res.redirect('/staff/login');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
            res.redirect('/staff/login');
        }
    }

};

module.exports = employeeController;
