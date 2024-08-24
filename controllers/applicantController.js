const applicantController = {

    getPublicHome: function(req, res) {
        res.render('publichome');
    },
    getPublicSignUp: function(req, res) {
        res.render('publicsignup');
    },


};

// Export the applicantController object
module.exports = applicantController;