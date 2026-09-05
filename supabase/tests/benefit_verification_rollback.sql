-- Integration checks against the linked database. Nothing is committed.
begin;
create temporary table benefit_test_context(key text primary key, value uuid);
insert into benefit_test_context select 'customer', id from public.profiles
 where public.normalize_role(role)='customer' and removed_at is null
 and not exists(select 1 from public.benefit_applications where customer_id=profiles.id) limit 1;
insert into benefit_test_context select 'other_customer', id from public.profiles
 where public.normalize_role(role)='customer' and removed_at is null
 and id <> (select value from benefit_test_context where key='customer') limit 1;
insert into benefit_test_context select 'admin', id from public.profiles where public.normalize_role(role)='admin' and removed_at is null limit 1;
insert into benefit_test_context select 'staff', id from public.profiles where public.normalize_role(role) in ('staff','operational_staff','cashier') and removed_at is null limit 1;
do $$ begin
 if (select count(*) from benefit_test_context)<>4 then raise exception 'Test requires two customers, a staff account and an admin'; end if;
end $$;
grant select,insert,update on benefit_test_context to authenticated;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', jsonb_build_object('sub',(select value from benefit_test_context where key='customer'),'role','authenticated')::text,true); end $$;
insert into storage.objects(bucket_id,name,metadata) values('benefit-documents',auth.uid()::text||'/rollback-verification-test.jpg','{"mimetype":"image/jpeg","size":100}');
do $$ declare a public.benefit_applications; invalid_id text; begin
 foreach invalid_id in array array['SC123456','123-456','123 456',repeat('1',21),' 123456 '] loop
  begin
   perform public.submit_benefit_application('pwd','Test Applicant',date '2000-01-01',invalid_id,auth.uid()::text||'/rollback-verification-test.jpg',true);
   raise exception 'Invalid ID number was accepted';
  exception when raise_exception then if sqlerrm not like 'Enter a valid ID number%' then raise; end if; end;
 end loop;
 begin
  perform public.submit_benefit_application('senior','Test Applicant',current_date,'001234567890',auth.uid()::text||'/rollback-verification-test.jpg',true);
  raise exception 'Underage Senior Citizen application was accepted';
 exception when raise_exception then if sqlerrm not like 'Senior Citizen applicants%' then raise; end if; end;
 begin
  perform public.submit_benefit_application('pwd','Test Applicant',date '2000-01-01','009876543210',null,true);
  raise exception 'Missing image was accepted';
 exception when raise_exception then if sqlerrm not like 'Upload a valid ID%' then raise; end if; end;
 begin
  perform public.submit_benefit_application('pwd','Test Applicant',date '2000-01-01','009876543210',auth.uid()::text||'/rollback-verification-test.jpg',false);
  raise exception 'Missing consent was accepted';
 exception when raise_exception then if sqlerrm not like 'Confirm your information%' then raise; end if; end;
 a := public.submit_benefit_application('pwd','Test Applicant',date '2000-01-01','009876543210',auth.uid()::text||'/rollback-verification-test.jpg',true);
 insert into benefit_test_context values('application',a.id);
 if a.status<>'pending' or a.revision<>1 then raise exception 'Initial status is incorrect'; end if;
 if not exists(select 1 from public.benefit_applications where id=a.id) then raise exception 'Owner cannot read application'; end if;
 begin
  update public.benefit_applications set status='approved' where id=a.id;
  raise exception 'Customer could directly update approval';
 exception when insufficient_privilege then null; end;
 begin
  perform public.review_benefit_application(a.id,1,'approved','');
  raise exception 'Customer could self-approve';
 exception when raise_exception then if sqlerrm<>'Administrator access required' then raise; end if; end;
 begin
  perform public.submit_benefit_application('pwd','Test Applicant',date '2000-01-01','009876543210',a.document_path,true);
  raise exception 'Duplicate pending application was accepted';
 exception when raise_exception then if sqlerrm<>'This application cannot be submitted again' then raise; end if; end;
end $$;
do $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from benefit_test_context where key='other_customer'),'role','authenticated')::text,true);
 if exists(select 1 from public.benefit_applications where id=(select value from benefit_test_context where key='application')) then raise exception 'Another customer can read the application'; end if;
 if exists(select 1 from storage.objects where bucket_id='benefit-documents' and name=(select value::text from benefit_test_context where key='customer')||'/rollback-verification-test.jpg') then raise exception 'Another customer can read the ID'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from benefit_test_context where key='staff'),'role','authenticated')::text,true);
 if exists(select 1 from public.benefit_applications where id=(select value from benefit_test_context where key='application')) then raise exception 'Staff can read private application'; end if;
 if exists(select 1 from storage.objects where bucket_id='benefit-documents' and name=(select value::text from benefit_test_context where key='customer')||'/rollback-verification-test.jpg') then raise exception 'Staff can read private ID'; end if;
 begin
  perform public.review_benefit_application((select value from benefit_test_context where key='application'),1,'approved','');
  raise exception 'Staff could approve';
 exception when raise_exception then if sqlerrm<>'Administrator access required' then raise; end if; end;
end $$;
do $$ declare a public.benefit_applications; begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from benefit_test_context where key='admin'),'role','authenticated')::text,true);
 if not exists(select 1 from storage.objects where bucket_id='benefit-documents' and name=(select value::text from benefit_test_context where key='customer')||'/rollback-verification-test.jpg') then raise exception 'Admin cannot read the submitted ID'; end if;
 begin
  perform public.review_benefit_application((select value from benefit_test_context where key='application'),1,'rejected','');
  raise exception 'Rejection without explanation accepted';
 exception when raise_exception then if sqlerrm not like 'Provide a reason%' then raise; end if; end;
 a := public.review_benefit_application((select value from benefit_test_context where key='application'),1,'resubmission','Please upload a clearer ID.');
 if a.status<>'resubmission' then raise exception 'Resubmission decision was not saved'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from benefit_test_context where key='customer'),'role','authenticated')::text,true);
 a := public.submit_benefit_application('pwd','Test Applicant',date '2000-01-01','009876543210',a.document_path,true);
 if a.status<>'pending' or a.revision<>2 or a.reviewed_by is not null then raise exception 'Resubmission did not reset review fields'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from benefit_test_context where key='admin'),'role','authenticated')::text,true);
 begin
  perform public.review_benefit_application(a.id,1,'approved','');
  raise exception 'Stale revision was accepted';
 exception when raise_exception then if sqlerrm not like 'Application changed%' then raise; end if; end;
end $$;
savepoint before_terminal_decision;
do $$ declare a public.benefit_applications; begin
 a := public.review_benefit_application((select value from benefit_test_context where key='application'),2,'approved','Verified.');
 if a.status<>'approved' then raise exception 'Approval was not saved'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select value from benefit_test_context where key='customer'),'role','authenticated')::text,true);
 begin
  perform public.submit_benefit_application('pwd','Test Applicant',date '2000-01-01','009876543210',a.document_path,true);
  raise exception 'Approved application could be overwritten';
 exception when raise_exception then if sqlerrm<>'This application cannot be submitted again' then raise; end if; end;
end $$;
rollback to savepoint before_terminal_decision;
do $$ declare a public.benefit_applications; begin
 a := public.review_benefit_application((select value from benefit_test_context where key='application'),2,'rejected','The ID could not be verified.');
 if a.status<>'rejected' then raise exception 'Rejection was not saved'; end if;
 if (select count(*) from public.benefit_application_events where application_id=a.id)<>4 then raise exception 'Audit events are missing'; end if;
end $$;
reset role;
rollback;
select 'PASS: role isolation, private ID access, validation, duplicate protection, resubmission, stale review prevention, approval, rejection and audit history. All test changes rolled back.' as result;
