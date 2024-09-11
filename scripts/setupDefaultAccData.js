require('dotenv').config();
const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

/* 
    The logic here is to make an initial account for HR to use if there are no other accs.
*/

// Function to initialize data
async function setupDefaultData() {
  try {
    console.log('Checking for existing user accounts...');
    const { data: users, error: userError } = await supabase
      .from('useraccounts')
      .select('*')
      .eq('userRole', 'HR');

    if (userError) {
      console.error('Error fetching users:', userError);
      throw userError;
    }

    console.log('Existing HR users:', users);

    if (users.length === 0) { // Only proceed if there are no HR users
      console.log('Inserting default department...');
      const { data: departments, error: departmentError } = await supabase
        .from('departments')
        .select('*')
        .eq('deptName', 'HR');

      if (departmentError) {
        console.error('Error fetching departments:', departmentError);
        throw departmentError;
      }

      console.log('Departments:', departments);

      let departmentId;
      if (departments.length === 0) {
        const { data: newDepartment, error: newDepartmentError } = await supabase
          .from('departments')
          .insert([{ deptName: 'HR' }])
          .select() // Ensure to fetch the inserted row
          .single();

        if (newDepartmentError) {
          console.error('Error inserting department:', newDepartmentError);
          throw newDepartmentError;
        }

        console.log('New Department Data:', newDepartment);
        departmentId = newDepartment.departmentId; // Correct field name
      } else {
        departmentId = departments[0].departmentId; // Correct field name
      }

      console.log('Inserting default job...');
      const { data: jobData, error: jobError } = await supabase
        .from('jobpositions')
        .insert([{ jobTitle: 'HR Head', departmentId, jobDescrpt: 'Responsible for overseeing the HR department' }])
        .select() // Ensure to fetch the inserted row
        .single();

      if (jobError) {
        console.error('Error inserting job:', jobError);
        throw jobError;
      }

      console.log('Job data:', jobData);

      if (!jobData || !jobData.jobId) {
        throw new Error('Failed to retrieve job ID');
      }

      const jobId = jobData.jobId;

      console.log('Hashing default password...');
      const hashedPassword = await bcrypt.hash('12345', 10);

      console.log('Inserting default user account...');
      const { data: userData, error: userInsertError } = await supabase
        .from('useraccounts')
        .insert([{ userPass: hashedPassword, userRole: 'HR', userIsDisabled: false, userEmail: 'admin@gmail.com', userStaffOgPass: '12345' }])
        .select() // Ensure to fetch the inserted row
        .single();

      if (userInsertError) {
        console.error('Error inserting user account:', userInsertError);
        throw userInsertError;
      }

      console.log('User data:', userData);

      const userId = userData.userId;

      console.log('Inserting default staff account...');
      const { data: staffData, error: staffError } = await supabase
        .from('staffaccounts')
        .insert([{ userId, departmentId, jobId, lastName: 'Doe', firstName: 'John' }])
        .select() // Ensure to fetch the inserted row
        .single();

      if (staffError) {
        console.error('Error inserting staff account:', staffError);
        throw staffError;
      }

      console.log('Staff data:', staffData);
      console.log('Default data has been successfully set up.');
    } else {
      console.log('Default HsR user account already exists.');
    }
  } catch (error) {
    console.error('Error setting up default data:', error);
  }
}

setupDefaultData();


/* 
- Store sensitive credentials in environment variables for security.
- Run your setup script manually or integrate it into your deployment process.
- Avoid placing sensitive or executable scripts in the public directory. 
*/

