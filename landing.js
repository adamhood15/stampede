(function () {
  var form = document.getElementById('signupForm');
  var optErr = document.getElementById('optErr');
  var doneCard = document.getElementById('doneCard');
  var doneChannel = document.getElementById('doneChannel');

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (!form.reportValidity()) return;

    var byEmail = form.optEmail.checked;
    var bySms = form.optSms.checked;

    if (!byEmail && !bySms) {
      optErr.hidden = false;
      return;
    }
    optErr.hidden = true;

    doneChannel.textContent = byEmail && bySms ? 'by email and text'
      : bySms ? 'by text'
      : 'by email';

    form.hidden = true;
    doneCard.hidden = false;
  });
})();
