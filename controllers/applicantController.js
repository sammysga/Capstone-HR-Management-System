const supabase = require ('../public/config/supabaseClient');
const bcrypt = require ('bcrypt');

const applicantController = {

    getPublicHome: function(req, res) {
        res.render('publichome');
    },
    getPublicSignUp: function(req, res) {
        res.render('publicsignup');
    },

    handleRegisterPage: async function(req, res) {
        console.log('Handling registration request...');
        const { lastName, firstName, middleName, birthDate, email, password, confirmPassword } = req.body;

        // Validate password on the server-side
        if (!password || password !== confirmPassword) {
            const errorMessage = 'Invalid password or password mismatch';
            console.error(errorMessage);
            return res.status(400).render('publicsignup', { message: errorMessage });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            const errorMessage = 'Invalid email format';
            console.error(errorMessage);
            return res.status(400).render('publicsignup', { message: errorMessage });
        }

        // Check if the email already exists in the database
        const { data: existingData, error: existingDataError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userEmail', email);

        if (existingDataError || (existingData && existingData.length > 0)) {
            const errorMessage = 'Please try again, email is already existing.';
            console.error(existingDataError || errorMessage);
            return res.status(400).render('publicsignup', { message: errorMessage });
        }

        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Hashed Password:', hashedPassword);  // Log the hashed password

        // Insert data into the useraccounts table
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .insert([
                {
                    userEmail: email,
                    userPass: hashedPassword,
                    userRole: 'Applicant',
                    userStatus: true,
                },
            ])
            .select('userId')
            .single();

        if (userError) {
            console.error('Error inserting data into the useraccounts table:', userError);
            const errorMessage = 'Error inserting data into the database';
            return res.status(500).render('publicsignup', { message: errorMessage });
        }

        const userId = userData.userId;

        // Insert data into the applicantaccounts table
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .insert([
                {
                    userId: userId,
                    lastName: lastName,
                    firstName: firstName,
                    middleInitial: middleName,
                    birthDate: birthDate,
                    applicantStatus: 'Account initially created',
                },
            ]);

        if (applicantError) {
            console.error('Error inserting data into the applicantaccounts table:', applicantError);
            const errorMessage = 'Error inserting applicant data into the database';
            return res.status(500).render('publicsignup', { message: errorMessage });
        }

        // Redirect to the login page upon successful registration
        res.redirect('/login');
    },


};

// Export the applicantController object
module.exports = applicantController;